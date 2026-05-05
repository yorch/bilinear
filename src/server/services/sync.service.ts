import type { Redis } from 'ioredis';
import type { PrismaClient, SyncAction } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'sync' });

// Maximum SyncAction rows returned per delta request. Keeps the server
// memory footprint bounded even when a client has been offline for weeks.
const DELTA_PAGE_SIZE = 5000;

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
      // TODO: paginate if a project org accumulates >500 updates
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
      this.prisma.syncAction.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
        where: { organizationId: orgId },
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
   * Fetch up to `limit` SyncActions strictly after `lastSyncId`. Capped so a
   * long-offline client (days/weeks) cannot request a multi-million-row
   * response that OOMs the server. Callers paginate by resubmitting with the
   * last returned id until `hasMore` is false.
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
      orderBy: { id: 'asc' },
      take: limit + 1,
      where: {
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
      orderBy: { id: 'desc' },
      select: { id: true },
      where: { organizationId: orgId },
    });
    return last?.id ?? BigInt(0);
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
