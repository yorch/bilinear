import type { Redis } from 'ioredis';
import { Prisma, type PrismaClient } from '../../generated/prisma';
import {
  DELTA_PAGE_SIZE,
  MAX_PLAUSIBLE_XACT_ID,
  SYNC_ACTION_RETENTION_DAYS,
} from '../../lib/sync-config';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'sync' });

// Maximum SyncAction rows returned per delta request. Keeps the server
// memory footprint bounded even when a client has been offline for weeks.
// Sourced from the shared `sync-config` module so client and server can't
// silently drift — see `src/lib/sync-config.ts`.
export { DELTA_PAGE_SIZE };

/**
 * Per-model fields that must never ride a SyncAction payload.
 *
 * Enforced at `recordSyncAction` rather than at each row's producer: ~20
 * emitters pass through here, several of them raw `prisma.issue.findUnique`
 * calls in `automation.service.ts` and `ws/index.ts` that never touch
 * `IssueService`, so a per-service fix would miss them.
 *
 * - `descriptionState`/`contentState` are Yjs collaborative-editing blobs
 *   re-synced through Hocuspocus, not this stream. A `Bytes` column nested in a
 *   jsonb param does not throw — it is base64-encoded — so leaving them in
 *   silently shipped ~1.33x the blob to every client in the org and into their
 *   IndexedDB. `getBootstrapData` already omits them for the same reason.
 * - `Organization.authSettings`/`securitySettings` are admin-console settings
 *   blobs; a SyncAction fans out to every member.
 */
const SYNC_PAYLOAD_OMITTED_FIELDS: Record<string, readonly string[]> = {
  Document: ['contentState'],
  Issue: ['descriptionState'],
  Organization: ['authSettings', 'securitySettings'],
};

function stripSyncPayload(modelName: string, data: object | null): object | null {
  const omitted = SYNC_PAYLOAD_OMITTED_FIELDS[modelName];
  if (!omitted || data === null) {
    return data;
  }
  const record = data as Record<string, unknown>;
  // Keep the common path allocation-free — most rows carry none of these.
  if (!omitted.some(field => field in record)) {
    return data;
  }
  const copy = { ...record };
  for (const field of omitted) {
    delete copy[field];
  }
  return copy;
}

/**
 * Per-project cap on bootstrap project updates. Applied as a nested `take` so
 * one busy project cannot crowd every other project's updates out of the cache
 * — an org-wide `take` silently truncated whole projects to nothing.
 */
const BOOTSTRAP_PROJECT_UPDATES_PER_PROJECT = 50;

/**
 * Org-level ceiling on the same. The per-project cap alone bounds nothing at
 * org level — 300 projects would ship 15k rich-text bodies — so the flattened
 * result is trimmed newest-first. Both caps are needed: one for fairness
 * between projects, one to bound the payload regardless of project count.
 * Anything beyond is reachable online through `Project.updates`.
 */
const BOOTSTRAP_PROJECT_UPDATES_TOTAL = 1000;

export type SyncActionType = 'I' | 'U' | 'D' | 'A';

/**
 * Columns on `User` that must never leave the server.
 *
 * A user payload goes to every member of the org and is persisted in
 * plaintext in IndexedDB. `DBUser` declares none of these, so they were
 * invisible in TypeScript while still being shipped; `calendarFeedToken` is
 * the bearer secret in the per-user iCal feed URL.
 *
 * Exported because the bootstrap is not the only sender: `announceJoin`
 * broadcasts a `User` row on the live path too, and two hand-maintained
 * copies of this list means a new sensitive column leaks from whichever one
 * the author forgot. Add a column here and both paths are covered.
 */
export const USER_SYNC_OMIT = {
  calendarFeedToken: true,
  githubId: true,
  googleId: true,
  isPlatformAdmin: true,
  passwordHash: true,
} as const;

/**
 * A persisted SyncAction, augmented with its `xactId` — the writing
 * transaction's xid8. `xact_id` is an `Unsupported("xid8")` column that the
 * Prisma client can't select, so every read/write path in this service goes
 * through raw SQL and returns THIS shape (not the Prisma `SyncAction` model
 * type, which lacks `xactId`). `xactId` is what the delta cursor and the
 * client's `lastSyncId` are keyed on — see `getDeltaSyncActions`.
 */
export interface SyncActionRow {
  action: string;
  createdAt: Date;
  data: Prisma.JsonValue | null;
  id: bigint;
  modelId: string;
  modelName: string;
  organizationId: string;
  xactId: bigint;
}

/**
 * Shape returned by the raw `RETURNING`/`SELECT` clauses below. `xact_id` is
 * cast to text (`xid8::text`) so it survives the driver as a decimal string;
 * `mapRow` parses it back to a BigInt.
 */
interface RawSyncActionRow {
  action: string;
  createdAt: Date;
  data: Prisma.JsonValue | null;
  id: bigint;
  modelId: string;
  modelName: string;
  organizationId: string;
  xactId: string;
}

function mapRow(row: RawSyncActionRow): SyncActionRow {
  return { ...row, xactId: BigInt(row.xactId) };
}

// Columns every SyncAction read/write returns, with xact_id rendered as text.
const SYNC_ACTION_COLUMNS = Prisma.sql`
  "id",
  "organization_id" AS "organizationId",
  "action",
  "model_name" AS "modelName",
  "model_id" AS "modelId",
  "data",
  "created_at" AS "createdAt",
  "xact_id"::text AS "xactId"
`;

/**
 * Minimal Prisma surface needed to persist a SyncAction. Both the singleton
 * client and an interactive `$transaction` client (`Prisma.TransactionClient`)
 * satisfy it structurally, so `recordSyncAction` can write the marker row
 * inside the SAME transaction as the business write — see `recordSyncAction`.
 * `$queryRaw` (not `syncAction`) because the insert must `RETURNING xact_id`,
 * a column the Prisma query builder can't select.
 */
export type SyncWriteClient = Pick<PrismaClient, '$queryRaw'>;

/**
 * Opaque cursor encoding a `(xactId, id)` tuple as `<xactId>-<id>`. Tuple
 * ordering is critical: BIGSERIAL `id` values alone race when transactions
 * commit out of order, so the delta query advances strictly by the writing
 * transaction's xid8 (`xact_id`), breaking ties by id. `xactId` is a 64-bit
 * Postgres transaction id — see `getDeltaSyncActions` for the commit-order
 * fence that makes this never-skip.
 *
 * `parseCursor` self-heals BOTH older encodings:
 *   - the original `<id>` (no dash) → `(0, id)`; and
 *   - the intermediate `<committedAtMicros>-<id>`, whose first component is an
 *     epoch-microseconds value far above any real xid8 (see
 *     `MAX_PLAUSIBLE_XACT_ID`) → reset to the zero cursor.
 * Either way the next delta re-reads from the very beginning (all real xid8
 * values are > 0), i.e. it picks up everything, instead of stalling.
 */
export interface DeltaCursor {
  id: bigint;
  xactId: bigint;
}

const ZERO_CURSOR: DeltaCursor = { id: BigInt(0), xactId: BigInt(0) };

export function parseCursor(raw: string | null | undefined): DeltaCursor {
  if (!raw) {
    return ZERO_CURSOR;
  }
  const dash = raw.indexOf('-');
  if (dash === -1) {
    // Legacy `<id>` only — treat xactId as 0 so a re-read starts from the
    // very beginning (all real xid8 values are > 0).
    try {
      return { id: BigInt(raw), xactId: BigInt(0) };
    } catch {
      return ZERO_CURSOR;
    }
  }
  try {
    const xactId = BigInt(raw.slice(0, dash));
    // A first component at/above the plausible-xid ceiling is a stale
    // `<committedAtMicros>-<id>` cursor from before the xact_id migration —
    // reset so delta re-reads from the start rather than filtering to nothing.
    if (xactId >= MAX_PLAUSIBLE_XACT_ID) {
      return ZERO_CURSOR;
    }
    return { id: BigInt(raw.slice(dash + 1)), xactId };
  } catch {
    return ZERO_CURSOR;
  }
}

export function encodeCursor(xactId: bigint, id: bigint): string {
  return `${xactId.toString()}-${id.toString()}`;
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
  ): Promise<SyncActionRow> {
    // Raw INSERT ... RETURNING so we get the DB-assigned `xact_id` back in a
    // single round-trip — the Prisma query builder can't select the
    // Unsupported("xid8") column. `data` is bound as a jsonb param (a JSON
    // string, or NULL for delete markers). `xact_id`/`created_at` fall to
    // their column DEFAULTs (`pg_current_xact_id()` / now()).
    const rows = await client.$queryRaw<RawSyncActionRow[]>(Prisma.sql`
      INSERT INTO "sync_actions" ("organization_id", "action", "model_name", "model_id", "data")
      VALUES (
        ${orgId}::uuid,
        ${action},
        ${modelName},
        ${modelId}::uuid,
        ${(() => {
          const payload = stripSyncPayload(modelName, data);
          return payload === null ? null : JSON.stringify(payload);
        })()}::jsonb
      )
      RETURNING ${SYNC_ACTION_COLUMNS}
    `);
    return mapRow(rows[0]);
  }

  /**
   * Broadcast an already-persisted SyncAction to the org's WebSocket clients.
   * Fire-and-forget — the DB row is the source of truth and delta sync fills
   * any gap from a failed publish, so awaiting here would add latency for no
   * correctness benefit. Safe to call after a transaction commits.
   */
  publish(action: SyncActionRow): void {
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
  ): Promise<SyncActionRow> {
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
    // Spread directly rather than wrapping in `AND: [guestVisibilityClause]`
    // — none of the four where-clauses below already declare a top-level
    // `OR`, so Prisma's implicit AND between sibling keys already composes
    // this `OR` with the existing archivedAt/organizationId/trashed filters
    // identically to the explicit `AND` wrapper (see buildWhere in
    // issue.service.ts for the same underlying pattern). If a future
    // clause here ever needs its own top-level `OR`, that one call site
    // will need the `AND: [...]` wrapper back to avoid the two `OR` keys
    // colliding.
    const withGuestVisibility = <T extends object>(where: T): T =>
      guestVisibilityClause ? ({ ...where, ...guestVisibilityClause } as T) : where;

    // Take the cursor BEFORE the (non-atomic, individually-snapshotted) entity
    // reads below — never inside their `Promise.all`. Under READ COMMITTED each
    // query gets its own snapshot, so a transaction that commits DURING
    // bootstrap could otherwise land in the cursor (settled by the cursor read)
    // yet be absent from an entity read that snapshotted earlier — and delta,
    // which reads strictly after the cursor, would never re-fetch it. Reading
    // the cursor first guarantees it sits at or below every entity snapshot:
    // any transaction still in flight at cursor time has `xact_id` ABOVE the
    // cursor (the fence excludes it from the max), so the first delta re-reads
    // it, closing the bootstrap→delta gap. Costs one sequential round-trip, the
    // same shape the former `watermark()` pre-fetch had.
    const bootstrapCursor = await this.latestSettledCursor(orgId);

    const [
      organizations,
      organizationMembers,
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
      projectsWithUpdates,
      customViews,
      issueRelations,
      issueTemplates,
      customFieldDefinitions,
      customFieldValues,
      initiatives,
      initiativeProjects,
    ] = await Promise.all([
      this.prisma.organization.findUnique({
        // Both are settings blobs for the admin console (SSO config, security
        // policy) — they reach every member's IndexedDB from here otherwise.
        omit: { authSettings: true, securitySettings: true },
        where: { id: orgId },
      }),
      // The org roster. Ships alongside `users` rather than being folded into
      // it because the two answer different questions: `users` is "who can I
      // see", populated for anyone with a membership, while this is "who is
      // still in this workspace, and as what". Removing someone deletes the
      // membership but never the User row, so without this the settings page
      // could not tell a departed member from a current one without its own
      // query — which is exactly why the `'D' OrganizationMember` SyncAction
      // had no client to act on it.
      this.prisma.organizationMember.findMany({
        where: { organizationId: orgId },
      }),
      this.prisma.team.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.user.findMany({
        omit: USER_SYNC_OMIT,
        where: { orgMemberships: { some: { organizationId: orgId } } },
      }),
      this.prisma.issue.findMany({
        // descriptionState is a YJS binary blob used only by the detail
        // panel's collaborative editor (re-synced via Hocuspocus, not the
        // bootstrap payload) — pure over-fetch here, same reasoning as
        // IssueService.findMany/findByTeamId.
        omit: { descriptionState: true },
        where: withGuestVisibility({
          archivedAt: null,
          organizationId: orgId,
          trashed: false,
        }),
      }),
      this.prisma.workflowState.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.issueLabel.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.issueLabelAssignment.findMany({
        where: {
          issue: withGuestVisibility({
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
          }),
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
      // Read through the project relation so the cap applies PER PROJECT
      // (Prisma runs a nested `take` once per parent row) instead of once
      // across the whole org. The `archivedAt: null` on the update itself
      // matters: deleting one is a soft delete that broadcasts a 'D' action, so
      // live clients drop it — but a client bootstrapping afterwards used to
      // download it again.
      this.prisma.project.findMany({
        select: {
          updates: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: BOOTSTRAP_PROJECT_UPDATES_PER_PROJECT,
            where: { archivedAt: null },
          },
        },
        where: { archivedAt: null, organizationId: orgId, trashed: false },
      }),
      this.prisma.customView.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.issueRelation.findMany({
        where: {
          issue: withGuestVisibility({
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
          }),
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
          issue: withGuestVisibility({
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
          }),
        },
      }),
      this.prisma.initiative.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.initiativeProject.findMany({
        where: { initiative: { archivedAt: null, organizationId: orgId } },
      }),
    ]);

    // Denormalize label IDs onto each issue
    const labelIdsByIssue = new Map<string, string[]>();
    for (const a of labelAssignments) {
      const ids = labelIdsByIssue.get(a.issueId) ?? [];
      ids.push(a.labelId);
      labelIdsByIssue.set(a.issueId, ids);
    }

    // Newest-first across the whole org, then trimmed — the ordering decides
    // which survive the org-level cap, so it drops the oldest rather than
    // whichever projects happen to sort last. `id` breaks `createdAt` ties so
    // the trim is deterministic across bootstraps.
    const projectUpdates = projectsWithUpdates
      .flatMap(p => p.updates)
      .sort((a, b) => {
        const byDate = b.createdAt.getTime() - a.createdAt.getTime();
        return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
      })
      .slice(0, BOOTSTRAP_PROJECT_UPDATES_TOTAL);

    const cursor = bootstrapCursor;

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
      organizationMembers,
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
   * Fetch up to `limit` SyncActions strictly after the cursor, fenced to
   * rows whose writing transaction has SETTLED. The cursor is a
   * `(xactId, id)` tuple — using id alone would skip any row whose
   * transaction committed out of order with its BIGSERIAL id (a slow tx
   * whose id is lower than a later-started-but-faster-committing tx).
   *
   * The fence is `xact_id < pg_snapshot_xmin(pg_current_snapshot())`:
   * `pg_snapshot_xmin` is the oldest transaction id still considered
   * in-progress at this statement's snapshot, so every row with a smaller
   * `xact_id` has already committed or aborted — and, crucially, NO
   * still-running transaction can later insert a row with an `xact_id`
   * below the cursor. Ordering by `(xact_id, id)` and never serving a row
   * at or above the fence therefore gives a provably never-skip cursor
   * that advances strictly forward, with no wall-clock guess. This is the
   * robust replacement for the former `committed_at = statement_timestamp()`
   * + 500ms window, which could miss a transaction that inserted early and
   * took longer than the window to commit.
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
  /**
   * Delete `sync_actions` rows older than the retention window, and record how
   * far the deletion reached so `getDeltaSyncActions` can recognise a cursor
   * that can no longer be caught up.
   *
   * Prunes on `created_at` (which has its own index) rather than `xact_id`:
   * retention is a wall-clock policy, and xid8 ordering is a commit order, not
   * a time order. But the *mark* is the highest `xact_id` actually deleted,
   * because that is the space the cursor lives in.
   *
   * One statement, deliberately. An earlier version marked and deleted
   * separately, which left a window where a delta could read the old mark and
   * be served a silently incomplete page — advancing its cursor past rows that
   * no longer exist. A data-modifying CTE makes both halves atomic, so a
   * concurrent delta sees either the whole prune or none of it.
   *
   * `GREATEST(COALESCE(existing, 0), …)` because the mark must never move
   * backwards: under-reporting staleness corrupts a cache, over-reporting costs
   * one bootstrap.
   */
  async pruneSyncActions(): Promise<number> {
    const cutoffMs = Date.now() - SYNC_ACTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs);

    const [result] = await this.prisma.$queryRaw<Array<{ deleted: number; orgs: number }>>(
      Prisma.sql`
        WITH deleted AS (
          DELETE FROM "sync_actions"
          WHERE "created_at" < ${cutoff}
          RETURNING "organization_id", "xact_id"::text::numeric AS "xact_num"
        ), marks AS (
          SELECT "organization_id", MAX("xact_num") AS "max_xact"
          FROM deleted
          GROUP BY "organization_id"
        ), marked AS (
          UPDATE "organizations" o
          SET "sync_actions_pruned_through_xact_id" =
            GREATEST(COALESCE(o."sync_actions_pruned_through_xact_id", 0), m."max_xact")
          FROM marks m
          WHERE o."id" = m."organization_id"
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM deleted)::int AS "deleted",
          (SELECT count(*) FROM marked)::int AS "orgs"
      `,
    );

    const deleted = result?.deleted ?? 0;
    if (deleted > 0) {
      log.info(
        { count: deleted, orgCount: result?.orgs ?? 0, retentionDays: SYNC_ACTION_RETENTION_DAYS },
        'Pruned old sync actions',
      );
    }
    return deleted;
  }

  async getDeltaSyncActions(
    orgId: string,
    fromCursor: DeltaCursor,
    toCursor?: DeltaCursor,
    limit = DELTA_PAGE_SIZE,
    guestScope?: { userId: string; guestTeamIds: string[] },
  ): Promise<{ actions: SyncActionRow[]; hasMore: boolean; staleCursor: boolean }> {
    // A cursor at or below the retention high-water mark cannot be caught up:
    // the rows between it and the mark have been deleted. Serving whatever
    // survives would look like a successful sync while leaving the client's
    // cache permanently missing the pruned span, so tell it to re-bootstrap.
    //
    // Compared in xid8 space because that is what the cursor is keyed on — the
    // mark records the highest `xact_id` the sweep actually deleted, not a
    // wall-clock time, so it stays meaningful under the commit-order fence.
    const org = await this.prisma.organization.findUnique({
      select: { syncActionsPrunedThroughXactId: true },
      where: { id: orgId },
    });
    const prunedThrough = org?.syncActionsPrunedThroughXactId;
    if (prunedThrough !== null && prunedThrough !== undefined) {
      if (fromCursor.xactId < BigInt(prunedThrough.toString())) {
        return { actions: [], hasMore: false, staleCursor: true };
      }
    }

    const fromXact = fromCursor.xactId.toString();

    // Lower bound — `(xact_id, id) > (fromXact, fromId)`. xid8 is passed as a
    // decimal string cast to xid8 (which has the full set of comparison
    // operators, unlike the legacy `xid` type).
    const lowerBound = Prisma.sql`("xact_id" > ${fromXact}::xid8 OR ("xact_id" = ${fromXact}::xid8 AND "id" > ${fromCursor.id}))`;

    // Upper bound (only when toCursor is given) — a true tuple
    // `(xact_id, id) <= (toXact, toId)`. Without the id tie-break, rows
    // sharing toXact could leak past the intended bootstrap→delta ceiling.
    const upperBound = toCursor
      ? Prisma.sql`AND ("xact_id" < ${toCursor.xactId.toString()}::xid8 OR ("xact_id" = ${toCursor.xactId.toString()}::xid8 AND "id" <= ${toCursor.id}))`
      : Prisma.empty;

    // Request one extra row to cheaply detect whether the caller needs
    // another page, without a separate count query.
    const raw = await this.prisma.$queryRaw<RawSyncActionRow[]>(Prisma.sql`
      SELECT ${SYNC_ACTION_COLUMNS}
      FROM "sync_actions"
      WHERE "organization_id" = ${orgId}::uuid
        AND "xact_id" < pg_snapshot_xmin(pg_current_snapshot())
        AND ${lowerBound}
        ${upperBound}
      ORDER BY "xact_id" ASC, "id" ASC
      LIMIT ${limit + 1}
    `);
    const rows = raw.map(mapRow);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    if (guestScope && guestScope.guestTeamIds.length > 0) {
      const actions = await this.filterGuestVisibleActions(
        page,
        guestScope.guestTeamIds,
        guestScope.userId,
      );
      return { actions, hasMore, staleCursor: false };
    }

    return { actions: page, hasMore, staleCursor: false };
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
    rows: SyncActionRow[],
    guestTeamIds: string[],
    guestUserId: string,
  ): Promise<SyncActionRow[]> {
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
   * Current high-watermark cursor for an org, encoded as a `(xactId, id)`
   * tuple string. Callers persist this and feed it back to delta-sync.
   * Named `getLastSyncId` for back-compat with the pre-tuple cursor API
   * (return type changed from BigInt to opaque string).
   */
  async getLastSyncId(orgId: string): Promise<string> {
    return this.latestSettledCursor(orgId);
  }

  /**
   * The topmost SETTLED `(xactId, id)` tuple for an org, encoded as a cursor
   * string (or `'0-0'` when the org has no settled SyncActions yet).
   *
   * "Settled" = `xact_id < pg_snapshot_xmin(pg_current_snapshot())`, the same
   * commit-order fence `getDeltaSyncActions` uses: the returned cursor never
   * sits above a transaction still in flight, so a client that starts from it
   * (bootstrap handoff, or `getLastSyncId` on a mutation response) cannot skip
   * a row whose id is already assigned but whose commit lands later. This is a
   * single round-trip; unlike the former `watermark()` it needs no separate
   * `SELECT now()` — the fence is evaluated inline against the statement's own
   * snapshot, so there is no app-vs-DB clock to reconcile.
   */
  private async latestSettledCursor(orgId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ xactId: string; id: bigint }>>(Prisma.sql`
      SELECT "xact_id"::text AS "xactId", "id"
      FROM "sync_actions"
      WHERE "organization_id" = ${orgId}::uuid
        AND "xact_id" < pg_snapshot_xmin(pg_current_snapshot())
      ORDER BY "xact_id" DESC, "id" DESC
      LIMIT 1
    `);
    const last = rows[0];
    if (last) {
      return encodeCursor(BigInt(last.xactId), last.id);
    }

    // No settled rows — the caller is nonetheless fully caught up, it just
    // downloaded everything. Anchoring at '0-0' would read as "infinitely far
    // behind", so once this org has had anything pruned the next delta answers
    // `staleCursor` and sends the client straight back to bootstrap, forever.
    //
    // `xmin - 1` rather than `xmin`: the cursor is exclusive (`xact_id >`), and
    // a row sitting exactly at xmin belongs to a transaction still in flight.
    // Subtracting one keeps it deliverable once it settles.
    const [{ xmin }] = await this.prisma.$queryRaw<Array<{ xmin: string }>>(Prisma.sql`
      SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS "xmin"
    `);
    const frontier = BigInt(xmin);
    return encodeCursor(frontier > BigInt(0) ? frontier - BigInt(1) : BigInt(0), BigInt(0));
  }
}

/**
 * Serialize a SyncAction for JSON transport. `id` and `xactId` become strings
 * so the 64-bit values survive JSON; `xactId` is what the client uses to
 * advance its `(xactId, id)` delta cursor from a live-pushed action.
 */
export function serializeSyncAction(action: SyncActionRow) {
  return {
    ...action,
    createdAt: action.createdAt.toISOString(),
    id: action.id.toString(),
    xactId: action.xactId.toString(),
  };
}
