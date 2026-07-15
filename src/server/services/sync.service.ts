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
 * Minimal Prisma surface needed to persist a SyncAction. Both the singleton
 * client and an interactive `$transaction` client (`Prisma.TransactionClient`)
 * satisfy it structurally, so `recordSyncAction` can write the marker row
 * inside the SAME transaction as the business write — see `recordSyncAction`.
 */
export type SyncWriteClient = Pick<PrismaClient, 'syncAction'>;

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

  /**
   * Persist a SyncAction row using an explicit client WITHOUT publishing to
   * Redis. Pass an interactive `$transaction` client to make the marker write
   * atomic with the business write that precedes it: a crash/rollback between
   * the two now drops BOTH, so a persisted row can never lack its SyncAction
   * (the silent-divergence bug — a row that no client ever sees because delta
   * sync only ships rows that have a SyncAction).
   *
   * The caller is responsible for `publish()`-ing the returned action AFTER
   * the transaction commits — publishing inside the tx would broadcast a row
   * that a later rollback erases, creating a phantom on every client.
   */
  async recordSyncAction(
    client: SyncWriteClient,
    orgId: string,
    action: SyncActionType,
    modelName: string,
    modelId: string,
    data: object | null,
  ): Promise<SyncAction> {
    return client.syncAction.create({
      data: {
        action,
        data: data ?? undefined,
        modelId,
        modelName,
        organizationId: orgId,
      },
    });
  }

  /**
   * Broadcast an already-persisted SyncAction to the org's WebSocket clients.
   * Fire-and-forget — the DB row is the source of truth and delta sync fills
   * any gap from a failed publish, so awaiting here would add latency for no
   * correctness benefit. Safe to call after a transaction commits.
   */
  publish(action: SyncAction): void {
    void this.redis
      .publish(`sync:${action.organizationId}`, JSON.stringify(serializeSyncAction(action)))
      .catch(err => {
        log.error({ err, orgId: action.organizationId }, 'Redis publish error');
      });
  }

  /**
   * Non-transactional convenience: write a SyncAction on the singleton client
   * and publish it. Used by mutations that aren't (yet) wrapped in a
   * business-write transaction. New entity-carrying / cascading mutations
   * should instead thread `recordSyncAction(tx, …)` through the business
   * transaction and `publish()` after commit (see issueCreate/issueUpdate).
   */
  async createSyncAction(
    orgId: string,
    action: SyncActionType,
    modelName: string,
    modelId: string,
    data: object | null,
  ): Promise<SyncAction> {
    const syncAction = await this.recordSyncAction(
      this.prisma,
      orgId,
      action,
      modelName,
      modelId,
      data,
    );
    this.publish(syncAction);
    return syncAction;
  }

  /**
   * @param userId The caller's id — needed to evaluate guest visibility
   * (creator-or-assignee) against `guestTeamIds`. Non-guest callers should
   * still pass their own userId; it's only consulted when `guestTeamIds`
   * is non-empty.
   * @param guestTeamIds Team ids (within `orgId`) where the caller holds the
   * `guest` role — see `getGuestTeamIds` in `middleware/auth.ts`. When
   * non-empty, every issue-derived collection below is narrowed to: issues
   * on a NON-guest team, OR issues the caller created, OR issues the caller
   * is assigned to — mirroring the same visibility rule the top-level
   * `issues` query and `Project.issues` resolver apply (guests only see
   * their own work on teams where they're a guest). Empty array (the
   * default) means "not a guest anywhere" — no narrowing, full org data,
   * preserving prior behavior for ordinary members/admins/owners.
   */
  async getBootstrapData(orgId: string, userId: string, guestTeamIds: string[] = []) {
    // `AND` (not a top-level `OR`) so this composes with the existing
    // archivedAt/organizationId/trashed filters via implicit-AND — see
    // buildWhere in issue.service.ts for the same pattern.
    const guestVisibilityClause =
      guestTeamIds.length > 0
        ? {
            OR: [
              { teamId: { notIn: guestTeamIds } },
              { creatorId: userId },
              { assigneeId: userId },
            ],
          }
        : null;

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
        // descriptionState is a YJS binary blob used only by the detail
        // panel's collaborative editor (re-synced via Hocuspocus, not the
        // bootstrap payload) — pure over-fetch here, same reasoning as
        // IssueService.findMany/findByTeamId.
        omit: { descriptionState: true },
        where: {
          archivedAt: null,
          organizationId: orgId,
          trashed: false,
          ...(guestVisibilityClause ? { AND: [guestVisibilityClause] } : {}),
        },
      }),
      this.prisma.workflowState.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.issueLabel.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.issueLabelAssignment.findMany({
        where: {
          issue: {
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
            ...(guestVisibilityClause ? { AND: [guestVisibilityClause] } : {}),
          },
        },
      }),
      this.prisma.cycle.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.document.findMany({
        // contentState is the analogous YJS blob for documents — same
        // over-fetch reasoning as Issue.descriptionState above.
        omit: { contentState: true },
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
          issue: {
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
            ...(guestVisibilityClause ? { AND: [guestVisibilityClause] } : {}),
          },
          // A relation row embeds the OTHER issue's UUID + relation type too,
          // so a guest must be able to see BOTH endpoints — otherwise they'd
          // learn about (and the type of relation to) a relatedIssue on a
          // guest-restricted team purely through this row, even though they
          // can't see that issue through any other query. Only applied when
          // the caller is actually a guest somewhere; non-guests are
          // unaffected (guestVisibilityClause is null for them).
          ...(guestVisibilityClause ? { relatedIssue: guestVisibilityClause } : {}),
        },
      }),
      this.prisma.issueTemplate.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.customFieldDefinition.findMany({
        // Include workspace-scoped definitions (team_id IS NULL) alongside
        // team-scoped ones. organization_id is denormalised onto every row
        // (NOT NULL since the 2026-05-21 migration), so the workspace tenant
        // filter is a single column lookup.
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.customFieldValue.findMany({
        where: {
          issue: {
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
            ...(guestVisibilityClause ? { AND: [guestVisibilityClause] } : {}),
          },
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
   *
   * @param guestScope When the caller is a guest on one or more teams
   * (`guestTeamIds` non-empty), the returned page is post-filtered via
   * `filterGuestVisibleActions` so a guest never receives a SyncAction for
   * an issue (or issue-derived row) they can't see through the regular
   * `issues` query. Undefined (the default) means "not a guest anywhere" —
   * no filtering, preserving prior behavior. NOTE: filtering happens AFTER
   * the `limit`/`hasMore` page slice, so a guest-heavy page can come back
   * smaller than `limit` even when `hasMore` is true — callers already
   * paginate by resubmitting with the last cursor, so this just means an
   * extra round-trip, not a correctness gap.
   */
  async getDeltaSyncActions(
    orgId: string,
    fromCursor: DeltaCursor,
    toCursor?: DeltaCursor,
    limit = DELTA_PAGE_SIZE,
    guestScope?: { userId: string; guestTeamIds: string[] },
  ): Promise<{ actions: SyncAction[]; hasMore: boolean }> {
    const fromCommittedAt = new Date(Number(fromCursor.committedAtMicros / BigInt(1000)));
    const watermark = this.watermark();
    const toCommittedAt = toCursor
      ? new Date(Number(toCursor.committedAtMicros / BigInt(1000)))
      : null;

    // Hard upper-bound on committedAt — applied to BOTH branches of the
    // tuple-greater filter below. The watermark is the lag floor that
    // guarantees a row's tx has had time to commit; `toCommittedAt`, when
    // present, is the bootstrap→delta handoff ceiling. Take the smaller
    // so we never serve rows past either boundary, even when the
    // cursor's `committedAt` itself happens to fall inside the lag
    // window (which would otherwise let the lower-bound's same-time
    // branch sneak in a too-recent row and advance the cursor past
    // still-in-flight inserts).
    const upperCommittedAt = toCommittedAt && toCommittedAt < watermark ? toCommittedAt : watermark;

    // Lower bound — `(committedAt, id) > (fromCommittedAt, fromId)`,
    // expressed as the two OR branches Prisma needs.
    const lowerBound = {
      OR: [
        { committedAt: { gt: fromCommittedAt } },
        { committedAt: fromCommittedAt, id: { gt: fromCursor.id } },
      ],
    };

    // Upper bound (only when toCursor is given) — encoded as a true
    // tuple `(committedAt, id) <= (toCommittedAt, toId)`. Without the
    // id-tie-break, rows sharing toCommittedAt could leak past the
    // intended upper bound on a bootstrap→delta handoff.
    const upperBound =
      toCursor && toCommittedAt
        ? {
            OR: [
              { committedAt: { lt: toCommittedAt } },
              { committedAt: toCommittedAt, id: { lte: toCursor.id } },
            ],
          }
        : null;

    // Request one extra row to cheaply detect whether the caller needs
    // another page, without a separate count query.
    const rows = await this.prisma.syncAction.findMany({
      orderBy: [{ committedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      where: {
        AND: [
          { committedAt: { lte: upperCommittedAt } },
          lowerBound,
          ...(upperBound ? [upperBound] : []),
        ],
        organizationId: orgId,
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    if (guestScope && guestScope.guestTeamIds.length > 0) {
      const actions = await this.filterGuestVisibleActions(
        page,
        guestScope.guestTeamIds,
        guestScope.userId,
      );
      return { actions, hasMore };
    }

    return { actions: page, hasMore };
  }

  /**
   * Post-filter a page of SyncActions so a guest caller only receives rows
   * for issues (or issue-derived rows) they're allowed to see — mirroring
   * `IssueService.buildWhere`'s `guestUserId` clause. SyncActions aren't a
   * clean fit for this: each row's `data` is a point-in-time JSON snapshot
   * taken at write time (see `recordSyncAction` call sites), not a live
   * join, so visibility has to be derived from whatever the payload itself
   * carries.
   *
   * Covers the two modelNames that carry issue-scoped data: `Issue` rows
   * embed `teamId`/`creatorId`/`assigneeId` directly (the full issue is the
   * payload); `IssueRelation`/`IssueReaction` rows embed `issueId` but not
   * the parent issue's team/creator/assignee, so those are resolved with a
   * single batched lookup instead of a query per row.
   *
   * A row with no `data` (delete actions are recorded with `data: null`)
   * carries nothing to leak beyond "this id was deleted", so it passes
   * through unfiltered — dropping it would just leave a stale row in a
   * guest's local cache with no confidentiality benefit.
   *
   * KNOWN RESIDUAL: other issue-derived writes (label/custom-field changes)
   * are folded into an `Issue` `U` SyncAction by their resolvers (see
   * custom-field.ts, issue.ts label handling) rather than getting their own
   * modelName, so they're covered by the `Issue` branch above. Any FUTURE
   * modelName that carries issue-derived data would need a case added here
   * — this is a denylist-by-omission, not a structurally-enforced guarantee.
   */
  private async filterGuestVisibleActions(
    rows: SyncAction[],
    guestTeamIds: string[],
    guestUserId: string,
  ): Promise<SyncAction[]> {
    const guestTeamSet = new Set(guestTeamIds);

    const relatedIssueIds = new Set<string>();
    for (const row of rows) {
      if ((row.modelName === 'IssueRelation' || row.modelName === 'IssueReaction') && row.data) {
        const data = row.data as Record<string, unknown>;
        if (typeof data.issueId === 'string') {
          relatedIssueIds.add(data.issueId);
        }
        // IssueRelation carries a SECOND issue endpoint (relatedIssueId) —
        // both sides need a visibility lookup, not just `issueId`, or a
        // guest could see a relation for a relatedIssue they can't
        // otherwise access.
        if (row.modelName === 'IssueRelation' && typeof data.relatedIssueId === 'string') {
          relatedIssueIds.add(data.relatedIssueId);
        }
      }
    }

    let issueLookup = new Map<
      string,
      { teamId: string; creatorId: string | null; assigneeId: string | null }
    >();
    if (relatedIssueIds.size > 0) {
      const found = await this.prisma.issue.findMany({
        select: { assigneeId: true, creatorId: true, id: true, teamId: true },
        where: { id: { in: [...relatedIssueIds] } },
      });
      issueLookup = new Map(found.map(i => [i.id, i]));
    }

    const canSee = (
      teamId: string | null | undefined,
      creatorId: string | null | undefined,
      assigneeId: string | null | undefined,
    ): boolean => {
      if (!teamId || !guestTeamSet.has(teamId)) {
        return true;
      }
      return creatorId === guestUserId || assigneeId === guestUserId;
    };

    return rows.filter(row => {
      if (!row.data) {
        return true;
      }
      const data = row.data as Record<string, unknown>;
      if (row.modelName === 'Issue') {
        return canSee(
          data.teamId as string | undefined,
          data.creatorId as string | undefined,
          data.assigneeId as string | undefined,
        );
      }
      if (row.modelName === 'IssueRelation' || row.modelName === 'IssueReaction') {
        const issueId = data.issueId as string | undefined;
        if (!issueId) {
          return true;
        }
        const info = issueLookup.get(issueId);
        // Issue no longer exists (hard-deleted) or wasn't found — nothing
        // left to gate visibility on; let it through rather than silently
        // dropping a row we can't reason about.
        if (info && !canSee(info.teamId, info.creatorId, info.assigneeId)) {
          return false;
        }

        // IssueRelation additionally embeds a relatedIssueId — a guest must
        // be able to see BOTH endpoints, since this row leaks the related
        // issue's UUID + relation type even when they can already see the
        // `issue` side.
        if (row.modelName === 'IssueRelation') {
          const relatedIssueId = data.relatedIssueId as string | undefined;
          if (relatedIssueId) {
            const relatedInfo = issueLookup.get(relatedIssueId);
            if (
              relatedInfo &&
              !canSee(relatedInfo.teamId, relatedInfo.creatorId, relatedInfo.assigneeId)
            ) {
              return false;
            }
          }
        }

        return true;
      }
      return true;
    });
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
