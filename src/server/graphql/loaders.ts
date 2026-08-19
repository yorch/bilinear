import DataLoader from 'dataloader';
import type {
  CustomView,
  Cycle,
  Document,
  Initiative,
  InitiativeUpdate,
  Issue,
  IssueLabel,
  IssueReaction,
  PrismaClient,
  Project,
  Team,
  User,
  WorkflowState,
} from '../../generated/prisma';
import { config } from '../config';
import { CycleService } from '../services/cycle.service';
import { IssueService } from '../services/issue.service';
import { ProjectService } from '../services/project.service';

/**
 * Per-request DataLoader bundle.
 *
 * GraphQL field resolvers like `Issue.assignee`, `Issue.team`, `Issue.state`
 * fire a `findUnique` per parent row. A query asking for 100 issues with
 * 6 relation fields produces ~600 round-trips (`N+1`); these loaders batch
 * the parallel `.load(id)` calls within a single tick into one
 * `findMany({ where: { id: { in: [...] } } })` per relation.
 *
 * Built fresh per request via `createLoaders(prisma)` and attached to
 * GraphQLContext — never share across requests so cache isolation matches
 * the request lifetime.
 *
 * Each loader returns the row (or null when missing) in the same order as
 * the input id array, which is a DataLoader contract requirement.
 */
export interface Loaders {
  /** Non-archived child initiatives of a parent initiative. */
  childrenByInitiativeId: DataLoader<string, Initiative[]>;
  /** Non-archived, non-trashed sub-issues of a parent issue, snooze-hidden
   * rows already excluded. Guest visibility is NOT applied here (it's
   * per-caller, not a property of the row set) — callers apply it in
   * memory against the returned array, same shape as before batching. */
  childrenByParentId: DataLoader<string, Issue[]>;

  /** CustomView lookup by id (org check left to the caller, as before). */
  customViewById: DataLoader<string, CustomView | null>;
  cycle: DataLoader<string, Cycle | null>;
  cycleProgress: DataLoader<string, { progress: number; scope: number }>;
  /** Document lookup by id (org check left to the caller, as before). */
  documentById: DataLoader<string, Document | null>;

  /** Org-scoped Initiative lookup by id. */
  initiativeById: DataLoader<string, Initiative | null>;

  /** Org-scoped Issue lookup by id (mirrors IssueService.findById, batched). */
  issueById: DataLoader<string, Issue | null>;
  /** Resolves to the IssueLabel[] currently assigned to the given issue. */
  labelsByIssueId: DataLoader<string, IssueLabel[]>;
  project: DataLoader<string, Project | null>;
  projectProgress: DataLoader<string, { progress: number; scope: number }>;
  /** IssueReaction rows (with `user` included) for a given issue, oldest first. */
  reactionsByIssueId: DataLoader<string, Array<IssueReaction & { user: User }>>;

  /**
   * `TeamMemberRole.role` for a `(teamId, userId)` pair, keyed as
   * `${teamId}::${userId}`. Mirrors the raw lookup `TeamMembership.role`
   * used to do (a `teamMemberRole.findUnique` defaulting to `'member'`
   * when no row exists) — NOT `getTeamRole`'s heavier membership+org+
   * allowlist check, which has different semantics and stays as its own
   * per-call helper (`isTeamGuest`/`getTeamRole` in middleware/auth.ts).
   */
  roleByTeamUser: DataLoader<string, string>;
  team: DataLoader<string, Team | null>;
  /** Non-archived InitiativeUpdate rows for an initiative, newest first. */
  updatesByInitiativeId: DataLoader<string, InitiativeUpdate[]>;
  user: DataLoader<string, User | null>;
  workflowState: DataLoader<string, WorkflowState | null>;
}

function indexById<T extends { id: string }>(rows: T[], ids: readonly string[]): Array<T | null> {
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => byId.get(id) ?? null);
}

/** Groups rows by a key field into arrays, preserving each group's relative
 * order from `rows`, then projects onto `keys` (missing keys map to `[]`). */
function groupBy<T, K extends string>(rows: T[], keys: readonly K[], keyOf: (row: T) => K): T[][] {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = grouped.get(key);
    if (list) {
      list.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return keys.map(key => grouped.get(key) ?? []);
}

const TEAM_USER_KEY_SEP = '::';

export function createLoaders(prisma: PrismaClient, orgId: string | null): Loaders {
  return {
    childrenByInitiativeId: new DataLoader(async (parentIds: readonly string[]) => {
      // Mirrors Initiative.children's previous per-row query exactly,
      // including its use of ctx.orgId (baked in here as `orgId`) rather
      // than the parent initiative's own organizationId. The field
      // resolver calls requireAuth(ctx) first (narrowing orgId to
      // non-null via its `asserts` signature) before ever reaching this
      // loader, so `orgId` is null here only in the defense-in-depth case
      // — treated the same way the original query's `organizationId: null`
      // would have been (no initiative rows have a null organizationId).
      if (!orgId) {
        return parentIds.map(() => []);
      }
      const rows = await prisma.initiative.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        where: {
          archivedAt: null,
          organizationId: orgId,
          parentId: { in: parentIds as string[] },
        },
      });
      return groupBy(rows, parentIds, r => r.parentId as string);
    }),

    childrenByParentId: new DataLoader(async (parentIds: readonly string[]) => {
      if (!orgId) {
        return parentIds.map(() => []);
      }
      // Mirrors Issue.children's previous per-row query: snooze-hide clause
      // plus organizationId/trashed scoping. Guest visibility (per-caller,
      // not per-row-set) is intentionally left out here — callers filter
      // the returned array in memory, same as before this was batched.
      const rows = await prisma.issue.findMany({
        orderBy: { subIssueSortOrder: 'asc' },
        where: {
          AND: [IssueService.snoozeHideClause()],
          organizationId: orgId,
          parentId: { in: parentIds as string[] },
          trashed: false,
        },
      });
      return groupBy(rows, parentIds, r => r.parentId as string);
    }),

    customViewById: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.customView.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    cycle: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.cycle.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    /**
     * Live `{ progress, scope }` per cycle.
     *
     * Batched through `CycleService.getProgressBatch`, which answers the whole
     * set in two `groupBy` queries and guarantees an entry for every requested
     * id, so the key-order projection below can never misalign. Mirrors
     * `projectProgress`; both exist because the columns these used to read
     * were never written.
     */
    cycleProgress: new DataLoader(async (ids: readonly string[]) => {
      const byId = await new CycleService(prisma, config).getProgressBatch(ids as string[]);
      return ids.map(id => byId.get(id) ?? { progress: 0, scope: 0 });
    }),

    documentById: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.document.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    initiativeById: new DataLoader(async (ids: readonly string[]) => {
      // Org-scoped, mirroring InitiativeService.findById(orgId, id).
      const rows = orgId
        ? await prisma.initiative.findMany({
            where: { id: { in: ids as string[] }, organizationId: orgId },
          })
        : [];
      return indexById(rows, ids);
    }),

    issueById: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.issue.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    labelsByIssueId: new DataLoader(async (issueIds: readonly string[]) => {
      const assignments = await prisma.issueLabelAssignment.findMany({
        include: { label: true },
        where: { issueId: { in: issueIds as string[] } },
      });
      return groupBy(assignments, issueIds, a => a.issueId).map(list => list.map(a => a.label));
    }),

    project: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.project.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    /**
     * Live completion ratio per project. `Project.progress`/`scope` are NOT
     * columns — the stored ones were removed precisely because nothing wrote
     * them and every reader silently rendered 0%.
     *
     * Batched through `ProjectService.getProgressBatch`, which answers the
     * whole set in two `groupBy` queries. The previous per-request memo still
     * issued two `issue.count` queries per project, so a 20-project list cost
     * 40 round-trips; `getProgressBatch` guarantees an entry for every
     * requested id, so the key-order projection below can never misalign.
     */
    projectProgress: new DataLoader(async (ids: readonly string[]) => {
      const byId = await new ProjectService(prisma).getProgressBatch(ids as string[]);
      return ids.map(id => byId.get(id) ?? { progress: 0, scope: 0 });
    }),

    reactionsByIssueId: new DataLoader(async (issueIds: readonly string[]) => {
      const rows = await prisma.issueReaction.findMany({
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        where: { issueId: { in: issueIds as string[] } },
      });
      return groupBy(
        rows as unknown as Array<IssueReaction & { user: User; issueId: string }>,
        issueIds,
        r => r.issueId,
      );
    }),

    roleByTeamUser: new DataLoader(async (keys: readonly string[]) => {
      const pairs = keys.map(key => {
        const idx = key.indexOf(TEAM_USER_KEY_SEP);
        return { teamId: key.slice(0, idx), userId: key.slice(idx + TEAM_USER_KEY_SEP.length) };
      });
      const teamIds = Array.from(new Set(pairs.map(p => p.teamId)));
      const userIds = Array.from(new Set(pairs.map(p => p.userId)));
      const rows = await prisma.teamMemberRole.findMany({
        select: { role: true, teamId: true, userId: true },
        where: { teamId: { in: teamIds }, userId: { in: userIds } },
      });
      // Superset query (cartesian of the distinct teamIds/userIds seen),
      // filtered back down to exact (teamId, userId) pairs via the map key
      // — safe because the key encodes both halves of the composite PK.
      const byKey = new Map(rows.map(r => [`${r.teamId}${TEAM_USER_KEY_SEP}${r.userId}`, r.role]));
      return keys.map(key => byKey.get(key) ?? 'member');
    }),

    team: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.team.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    updatesByInitiativeId: new DataLoader(async (initiativeIds: readonly string[]) => {
      // Mirrors InitiativeService.getInitiativeUpdates exactly (no org
      // filter there either — the parent Initiative is already org-scoped
      // by the time this field resolver runs).
      const rows = await prisma.initiativeUpdate.findMany({
        orderBy: { createdAt: 'desc' },
        where: { archivedAt: null, initiativeId: { in: initiativeIds as string[] } },
      });
      return groupBy(rows, initiativeIds, r => r.initiativeId);
    }),

    user: new DataLoader(async (ids: readonly string[]) => {
      // Defense-in-depth: scope to users with at least one membership in
      // the caller's org so a guessed UUID can't leak another org's user
      // metadata (name, email). When orgId is null (e.g. onboarding
      // queries before an org exists), fall back to the unscoped lookup
      // since there's nothing meaningful to filter on yet.
      const rows = await prisma.user.findMany({
        where: orgId
          ? {
              id: { in: ids as string[] },
              orgMemberships: { some: { organizationId: orgId } },
            }
          : { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    workflowState: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.workflowState.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),
  };
}
