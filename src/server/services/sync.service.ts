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

/**
 * Opaque cursor encoding a `(committedAt, id)` tuple as
 * `<committedAtMicros>-<id>`. Tuple ordering is critical: BIGSERIAL `id`
 * values alone can race when transactions commit out of order, so the
 * delta query advances strictly by committed-at, breaking ties by id.
 *
 * `parseCursor` is backward-compatible with the legacy `<id>` format —
 * a client persisted with the old encoding will be treated as cursor
 * `(epoch, id)` so the next delta picks up any rows whose committed_at
 * is after epoch (i.e. everything).
 */
export interface DeltaCursor {
  committedAtMicros: bigint;
  id: bigint;
}

const ZERO_CURSOR: DeltaCursor = { committedAtMicros: BigInt(0), id: BigInt(0) };

export function parseCursor(raw: string | null | undefined): DeltaCursor {
  if (!raw) {
    return ZERO_CURSOR;
  }
  const dash = raw.indexOf('-');
  if (dash === -1) {
    // Legacy `<id>` only — treat the row as if it committed at epoch so
    // a re-read picks up any rows with non-trivial committed_at.
    try {
      return { committedAtMicros: BigInt(0), id: BigInt(raw) };
    } catch {
      return ZERO_CURSOR;
    }
  }
  try {
    return {
      committedAtMicros: BigInt(raw.slice(0, dash)),
      id: BigInt(raw.slice(dash + 1)),
    };
  } catch {
    return ZERO_CURSOR;
  }
}

export function encodeCursor(committedAt: Date, id: bigint): string {
  const micros = BigInt(committedAt.getTime()) * BigInt(1000);
  return `${micros.toString()}-${id.toString()}`;
}

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
      // Watermarked latest row: order by (committedAt, id) DESC so the
      // returned cursor is the topmost tuple, NOT just max(id). If we used
      // max(id) here, a row whose tx is slow but already-inserted-but-
      // -uncommitted at bootstrap time could later commit with a smaller
      // committed_at than max(id)'s — and the next delta would skip it.
      this.prisma.syncAction.findFirst({
        orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
        select: { committedAt: true, id: true },
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

    const cursor = lastSyncAction
      ? encodeCursor(lastSyncAction.committedAt, lastSyncAction.id)
      : '0-0';

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
      lastSyncId: cursor,
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
   * Fetch up to `limit` SyncActions strictly after the cursor, but only
   * rows that have committed earlier than `now() - safety window`. The
   * cursor is a `(committedAt, id)` tuple — using id alone would skip
   * any row whose transaction committed out of order with its id (e.g.
   * a slow tx whose statement_timestamp is earlier than a later-id-but-
   * faster-committing tx). The trigger-populated `committedAt` column
   * is monotonic at INSERT time, so combined with the safety window we
   * get a never-skip cursor that advances strictly forward.
   *
   * Cap is per-page so a long-offline client cannot request a
   * multi-million-row response that OOMs the server; callers paginate
   * by resubmitting with the last returned cursor until `hasMore` is
   * false. `toCursor`, when provided, caps the upper bound — useful for
   * the bootstrap-then-delta handoff.
   */
  async getDeltaSyncActions(
    orgId: string,
    fromCursor: DeltaCursor,
    toCursor?: DeltaCursor,
    limit = DELTA_PAGE_SIZE,
  ): Promise<{ actions: SyncAction[]; hasMore: boolean }> {
    const fromCommittedAt = new Date(Number(fromCursor.committedAtMicros / BigInt(1000)));
    const watermark = this.watermark();

    // Tuple-greater-than filter expressed in Prisma:
    //   (committed_at, id) > (fromCommittedAt, fromId)
    // → committed_at > fromCommittedAt
    //   OR (committed_at = fromCommittedAt AND id > fromId)
    // The `committedAt <= watermark` clause inside each branch is what
    // gives the safety window its bite.
    const tupleAfter = [
      {
        committedAt: {
          gt: fromCommittedAt,
          lte: toCursor ? new Date(Number(toCursor.committedAtMicros / BigInt(1000))) : watermark,
        },
      },
      {
        committedAt: fromCommittedAt,
        id: { gt: fromCursor.id, ...(toCursor ? { lte: toCursor.id } : {}) },
      },
    ];

    // Request one extra row to cheaply detect whether the caller needs
    // another page, without a separate count query.
    const rows = await this.prisma.syncAction.findMany({
      orderBy: [{ committedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      where: {
        OR: tupleAfter,
        organizationId: orgId,
      },
    });
    const hasMore = rows.length > limit;
    return { actions: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  /**
   * Current high-watermark cursor for an org, encoded as a `(committedAt, id)`
   * tuple string. Callers persist this and feed it back to delta-sync.
   * Named `getLastSyncId` for back-compat with the pre-tuple cursor API
   * (return type changed from BigInt to opaque string).
   */
  async getLastSyncId(orgId: string): Promise<string> {
    const last = await this.prisma.syncAction.findFirst({
      orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
      select: { committedAt: true, id: true },
      where: {
        committedAt: { lte: this.watermark() },
        organizationId: orgId,
      },
    });
    return last ? encodeCursor(last.committedAt, last.id) : '0-0';
  }

  private watermark(): Date {
    return new Date(Date.now() - COMMITTED_WATERMARK_LAG_MS);
  }
}

/**
 * Serialize a SyncAction for JSON transport. `id` becomes a string so
 * BigInt survives JSON; `committedAt` is included as an ISO timestamp
 * so the client can carry the full `(committedAt, id)` cursor tuple.
 */
export function serializeSyncAction(action: SyncAction) {
  return {
    ...action,
    committedAt: action.committedAt.toISOString(),
    createdAt: action.createdAt.toISOString(),
    id: action.id.toString(),
  };
}
