import { expect, test as teardown } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { gqlInPage } from '../fixtures/graphql';

/**
 * Archive every issue the run created, leaving only the six the seed makes.
 *
 * Specs create throwaway issues and mostly don't remove them, which makes the
 * suite non-idempotent in a way that fails *other* tests. `GroupSection`
 * virtualizes a group past 20 rows, and past that a newly created row is not
 * in the DOM for `getByText(title)` to find — so the test that breaks is
 * whichever one next asserts "the issue I just made is in the list", with an
 * "element(s) not found" that points nowhere near the cause.
 *
 * That is not hypothetical. A run against a database left dirty by two
 * previous runs fails exactly ten tests, and they are the same ones that
 * spent months disabled as CI-load flakes: all four of `sync.spec.ts`, all
 * four of `offline.spec.ts`, `issue-crud`'s create, and `issue-detail`'s
 * inline edit. On a freshly seeded database all ten pass.
 *
 * Archiving rather than deleting is the app's own soft delete: the list
 * queries filter on `archivedAt IS NULL`, so it is precisely the state that
 * decides whether the threshold is crossed, and no history is destroyed.
 *
 * The seeded six are matched by identifier rather than by "existed before the
 * run", so a run that inherits a dirty database converges back to the seed
 * instead of preserving the mess. Specs may freely mutate those six — only
 * how many rows the list renders matters here.
 */

const SEEDED_IDENTIFIERS = new Set(['ENG-1', 'ENG-2', 'ENG-3', 'ENG-4', 'ENG-5', 'ENG-6']);

/** `Query.issues` clamps `first` to MAX_LIST_LIMIT (200). */
const PAGE_SIZE = 200;

interface IssueNode {
  id: string;
  identifier: string;
}

interface IssuePage {
  issues: {
    nodes: IssueNode[];
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
}

/**
 * Every non-seeded issue the admin can still see in a list.
 *
 * `includeSnoozed` is load-bearing, not defensive. Triage's snooze flow
 * leaves issues with a future `snoozedUntilAt`, and `Query.issues` hides
 * those by default — so without it this walked right past the rows it
 * exists to collect and reported a tidy "archived 0".
 */
async function findStaleIssues(page: Parameters<typeof openWorkspace>[0]): Promise<IssueNode[]> {
  const teamsRes = await gqlInPage<{ teams: Array<{ id: string; key: string }> }>(
    page,
    `query { teams { id key } }`,
  );
  expect(teamsRes.errors, 'teams query should succeed').toBeUndefined();
  const teams = teamsRes.data?.teams ?? [];
  expect(teams.length, 'seed should provide at least one team').toBeGreaterThan(0);

  const stale: IssueNode[] = [];
  for (const team of teams) {
    let after: string | null = null;
    do {
      const res: Awaited<ReturnType<typeof gqlInPage<IssuePage>>> = await gqlInPage<IssuePage>(
        page,
        `query($teamId: ID!, $first: Int!, $after: String) {
          issues(filter: { teamId: $teamId, includeSnoozed: true }, first: $first, after: $after) {
            nodes { id identifier }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { after, first: PAGE_SIZE, teamId: team.id },
      );
      // `Query.issues` rejects a call without `filter.teamId`, and an
      // unchecked `errors[]` reads as "nothing to clean up" — which is how
      // the first version of this file shipped as a no-op that looked green.
      expect(res.errors, `issues query for team ${team.key} should succeed`).toBeUndefined();
      const connection = res.data?.issues;
      if (!connection) {
        break;
      }
      stale.push(...connection.nodes.filter(n => !SEEDED_IDENTIFIERS.has(n.identifier)));
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
  }
  return stale;
}

teardown.use({ storageState: ADMIN_STATE });

teardown('archive issues created by this run', async ({ page }) => {
  await openWorkspace(page);

  const stale = await findStaleIssues(page);
  for (const issue of stale) {
    await gqlInPage(page, `mutation($id: ID!) { issueArchive(id: $id) { success } }`, {
      id: issue.id,
    });
  }

  // Assert the contract rather than the effort. Both bugs this teardown has
  // had — the missing team filter and the missing `includeSnoozed` — made it
  // archive nothing while reporting success, and neither would have been
  // caught by checking the mutation responses. Re-querying is the only check
  // that fails when cleanup silently stops working.
  const remaining = await findStaleIssues(page);
  expect(
    remaining.map(i => i.identifier),
    'every issue this run created should be archived; leftovers push the issue list past GroupSection’s 20-row virtualization threshold and break unrelated specs on the next run',
  ).toEqual([]);

  console.log(`[teardown] archived ${stale.length} issue(s) created by this run`);
});
