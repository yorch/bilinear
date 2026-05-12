import type { Redis } from 'ioredis';
import type { PrismaClient, SyncAction } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'sync' });

// Maximum SyncAction rows returned per delta request. Keeps the server
// memory footprint bounded even when a client has been offline for weeks.
const DELTA_PAGE_SIZE = 5000;

// Safety window for the committed-at watermark. Rows committed inside this
// window may have been preceded by a row whose transaction was still
// in-flight at our last read — wait for it to land before serving the
// span to a client. 500ms covers typical write tail latency comfortably
// while keeping real-time sync feel instant.
const COMMITTED_WATERMARK_LAG_MS = 500;

export type SyncActionType = 'I' | 'U' | 'D' | 'A';

export class SyncService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async createSyncAction(
    orgId: string,
    action: SyncActionType,
    modelName: string,
    modelId: string,
    data: object | null,
  ): Promise<SyncAction> {
    const syncAction = await this.prisma.syncAction.create({
      data: {
        action,
        data: data ?? undefined,
        modelId,
        modelName,
        organizationId: orgId,
      },
    });

    // Publish to Redis so the WebSocket server can broadcast to connected
    // clients. Detached from the mutation hot path — the DB write is the
    // source of truth, and delta sync will fill any gap caused by a failed
    // publish. Awaiting here adds ~1-50ms (plus tail-latency spikes) to
    // every mutation for no correctness benefit.
    void this.redis
      .publish(`sync:${orgId}`, JSON.stringify(serializeSyncAction(syncAction)))
      .catch(err => {
        log.error({ err, orgId }, 'Redis publish error');
      });

    return syncAction;
  }

  async getBootstrapData(orgId: string) {
    const [
      organizations,
      teams,
      users,
      issues,
      workflowStates,
      issueLabels,
      labelAssignments,
      cycles,
      documents,
      projects,
      projectMilestones,
      projectUpdates,
      customViews,
      issueRelations,
      issueTemplates,
      customFieldDefinitions,
      customFieldValues,
      initiatives,
      initiativeProjects,
      lastSyncAction,
    ] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId } }),
      this.prisma.team.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.user.findMany({
        where: { orgMemberships: { some: { organizationId: orgId } } },
      }),
      this.prisma.issue.findMany({
        where: { archivedAt: null, organizationId: orgId, trashed: false },
      }),
      this.prisma.workflowState.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.issueLabel.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.issueLabelAssignment.findMany({
        where: {
          issue: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.cycle.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.document.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.project.findMany({
        where: { archivedAt: null, organizationId: orgId, trashed: false },
      }),
      this.prisma.projectMilestone.findMany({
        where: {
          archivedAt: null,
          project: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.projectUpdate.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        where: {
          project: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.customView.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.issueRelation.findMany({
        where: {
          issue: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.issueTemplate.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.customFieldDefinition.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.customFieldValue.findMany({
        where: {
          issue: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.initiative.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.initiativeProject.findMany({
        where: { initiative: { archivedAt: null, organizationId: orgId } },
      }),
      // Use the watermarked latest row (see getDeltaSyncActions). Without
      // this, bootstrap could return a lastSyncId that points past an
      // earlier-id-but-later-commit row, leaving a permanent gap in the
      // client's delta stream.
      this.prisma.syncAction.findFirst({
        orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
        where: {
          committedAt: { lte: this.watermark() },
          organizationId: orgId,
        },
      }),
    ]);

    // Denormalize label IDs onto each issue
    const labelIdsByIssue = new Map<string, string[]>();
    for (const a of labelAssignments) {
      const ids = labelIdsByIssue.get(a.issueId) ?? [];
      ids.push(a.labelId);
      labelIdsByIssue.set(a.issueId, ids);
    }

    return {
      customFieldDefinitions,
      customFieldValues,
      customViews,
      cycles,
      documents,
      initiativeProjects,
      initiatives,
      issueLabels,
      issueRelations,
      issues: issues.map(i => ({
        ...i,
        labelIds: labelIdsByIssue.get(i.id) ?? [],
      })),
      issueTemplates,
      lastSyncId: (lastSyncAction?.id ?? BigInt(0)).toString(),
      organizations: organizations ? [organizations] : [],
      projectMilestones,
      projects,
      projectUpdates,
      teams,
      users,
      workflowStates,
    };
  }

  /**
   * Fetch up to `limit` SyncActions strictly after `lastSyncId`, but only
   * rows that have committed earlier than `now() - safety window`. The
   * watermark is critical: BIGSERIAL ids are assigned at INSERT, but
   * transactions commit out of order. Without the watermark, a client
   * that records `lastSyncId = N` could miss a row whose id is < N but
   * whose commit landed after the client's read. The trigger-populated
   * `committedAt` column gives us a monotonic ordering AT THE TIME OF
   * READ as long as we wait for all in-flight transactions to land.
   *
   * Cap is per-page so a long-offline client (days/weeks) cannot request
   * a multi-million-row response that OOMs the server; callers paginate
   * by resubmitting with the last returned id until `hasMore` is false.
   */
  async getDeltaSyncActions(
    orgId: string,
    lastSyncId: bigint,
    toSyncId?: bigint,
    limit = DELTA_PAGE_SIZE,
  ): Promise<{ actions: SyncAction[]; hasMore: boolean }> {
    // Request one extra row to cheaply detect whether the caller needs
    // another page, without a separate count query.
    const rows = await this.prisma.syncAction.findMany({
      orderBy: [{ committedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      where: {
        committedAt: { lte: this.watermark() },
        id: {
          gt: lastSyncId,
          ...(toSyncId ? { lte: toSyncId } : {}),
        },
        organizationId: orgId,
      },
    });
    const hasMore = rows.length > limit;
    return { actions: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  async getLastSyncId(orgId: string): Promise<bigint> {
    const last = await this.prisma.syncAction.findFirst({
      orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
      where: {
        committedAt: { lte: this.watermark() },
        organizationId: orgId,
      },
    });
    return last?.id ?? BigInt(0);
  }

  private watermark(): Date {
    return new Date(Date.now() - COMMITTED_WATERMARK_LAG_MS);
  }
}

/**
 * Serialize a SyncAction for JSON transport — BigInt id becomes a string.
 */
export function serializeSyncAction(action: SyncAction) {
  return {
    ...action,
    createdAt: action.createdAt.toISOString(),
    id: action.id.toString(),
  };
}
