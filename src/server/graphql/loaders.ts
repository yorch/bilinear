import DataLoader from 'dataloader';
import type {
  Cycle,
  IssueLabel,
  PrismaClient,
  Project,
  Team,
  User,
  WorkflowState,
} from '../../generated/prisma';

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
  cycle: DataLoader<string, Cycle | null>;
  /** Resolves to the IssueLabel[] currently assigned to the given issue. */
  labelsByIssueId: DataLoader<string, IssueLabel[]>;
  project: DataLoader<string, Project | null>;
  team: DataLoader<string, Team | null>;
  user: DataLoader<string, User | null>;
  workflowState: DataLoader<string, WorkflowState | null>;
}

function indexById<T extends { id: string }>(rows: T[], ids: readonly string[]): Array<T | null> {
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => byId.get(id) ?? null);
}

export function createLoaders(prisma: PrismaClient, orgId: string | null): Loaders {
  return {
    cycle: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.cycle.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    labelsByIssueId: new DataLoader(async (issueIds: readonly string[]) => {
      const assignments = await prisma.issueLabelAssignment.findMany({
        include: { label: true },
        where: { issueId: { in: issueIds as string[] } },
      });
      const grouped = new Map<string, IssueLabel[]>();
      for (const a of assignments) {
        const list = grouped.get(a.issueId);
        if (list) {
          list.push(a.label);
        } else {
          grouped.set(a.issueId, [a.label]);
        }
      }
      return issueIds.map(id => grouped.get(id) ?? []);
    }),

    project: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.project.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
    }),

    team: new DataLoader(async (ids: readonly string[]) => {
      const rows = await prisma.team.findMany({
        where: { id: { in: ids as string[] } },
      });
      return indexById(rows, ids);
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
