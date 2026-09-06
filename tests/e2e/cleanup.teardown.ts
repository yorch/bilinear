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

/** The seed creates exactly one team; everything else a run made is disposable. */
const SEEDED_TEAM_KEYS = new Set(['ENG']);

/**
 * Every project and initiative the specs create is named `E2E <something>`.
 *
 * Teams and the other two are filtered differently on purpose. A leftover
 * team BREAKS the next run — team keys are unique per org, so the second run
 * cannot recreate one — which is what justifies deleting every non-seeded
 * team. Projects and initiatives carry no such constraint, so leftovers are
 * only untidy, and matching on the prefix keeps a suite run pointed at a
 * database with real data from archiving rows it did not create.
 */
const E2E_NAME_PREFIX = 'E2E ';

interface NamedNode {
  id: string;
  name: string;
}

/**
 * Teams, projects and initiatives a run created. Specs make these with
 * fixed names and no cleanup, so a second run against the same database
 * collided on the unique team key and the sidebar accumulated a team per
 * run. Projects and initiatives are archived (the app's soft delete);
 * teams are deleted with their issues, which are throwaway by construction
 * — every seeded issue lives on the seeded team.
 */
async function findStaleContainers(page: Parameters<typeof openWorkspace>[0]) {
  const res = await gqlInPage<{
    initiatives: NamedNode[];
    projects: { nodes: NamedNode[] };
    teams: Array<NamedNode & { key: string }>;
  }>(
    page,
    `query {
      teams { id key name }
      projects(first: 200) { nodes { id name } }
      initiatives { id name }
    }`,
  );
  expect(res.errors, 'container queries should succeed').toBeUndefined();
  const madeByThisSuite = (n: NamedNode) => n.name.startsWith(E2E_NAME_PREFIX);
  return {
    initiatives: (res.data?.initiatives ?? []).filter(madeByThisSuite),
    projects: (res.data?.projects.nodes ?? []).filter(madeByThisSuite),
    teams: (res.data?.teams ?? []).filter(t => !SEEDED_TEAM_KEYS.has(t.key)),
  };
}

teardown.use({ storageState: ADMIN_STATE });

teardown('remove teams, projects and initiatives created by this run', async ({ page }) => {
  await openWorkspace(page);

  const stale = await findStaleContainers(page);
  for (const project of stale.projects) {
    const res = await gqlInPage(
      page,
      `mutation($id: ID!) { projectArchive(id: $id) { success } }`,
      {
        id: project.id,
      },
    );
    expect(res.errors, `archiving project ${project.name}`).toBeUndefined();
  }
  for (const initiative of stale.initiatives) {
    const res = await gqlInPage(
      page,
      `mutation($id: ID!) { initiativeArchive(id: $id) { success } }`,
      { id: initiative.id },
    );
    expect(res.errors, `archiving initiative ${initiative.name}`).toBeUndefined();
  }
  for (const team of stale.teams) {
    const res = await gqlInPage(
      page,
      `mutation($id: ID!) { teamDelete(id: $id, input: { issueAction: DELETE }) { success } }`,
      { id: team.id },
    );
    expect(res.errors, `deleting team ${team.key}`).toBeUndefined();
  }

  const remaining = await findStaleContainers(page);
  expect(
    remaining.teams.map(t => t.key),
    'every team this run created should be gone',
  ).toEqual([]);
  expect(
    remaining.projects.map(p => p.name),
    'every project should be archived',
  ).toEqual([]);
  expect(
    remaining.initiatives.map(i => i.name),
    'every initiative should be archived',
  ).toEqual([]);

  console.log(
    `[teardown] removed ${stale.teams.length} team(s), archived ${stale.projects.length} project(s) and ${stale.initiatives.length} initiative(s)`,
  );
});

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
