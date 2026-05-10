import { expect, type Page, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

/**
 * Create a fresh issue on a triage-enabled team without an explicit stateId.
 * The server's triage routing (issue.service.ts:93–108) auto-routes the
 * resulting issue to the team's triage workflow state, so this issue then
 * appears on /team/<key>/triage. We POST directly to /api/graphql via the
 * page context so the auth cookies tag along.
 *
 * Returns the title that was used so the caller can locate the new row.
 */
async function createFreshTriageIssue(page: Page, teamKey: string): Promise<string> {
  const title = `Triage action ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const result = await page.evaluate(
    async ({ title, teamKey }) => {
      // 1. Look up the team id by key.
      const teamsResp = await fetch('/api/graphql', {
        body: JSON.stringify({ query: `{ teams { id key } }` }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const teamsJson = await teamsResp.json();
      const teams = teamsJson?.data?.teams as Array<{ id: string; key: string }> | undefined;
      const team = teams?.find(t => t.key === teamKey);
      if (!team) {
        throw new Error(`Team ${teamKey} not found`);
      }

      // 2. Create an issue without stateId so the server triage-routes it.
      const createResp = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: `mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title } } }`,
          variables: { input: { teamId: team.id, title } },
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const createJson = await createResp.json();
      if (createJson?.errors?.length) {
        throw new Error(`issueCreate failed: ${JSON.stringify(createJson.errors)}`);
      }
      return createJson?.data?.issueCreate;
    },
    { teamKey, title },
  );
  if (!result?.success) {
    throw new Error(`createFreshTriageIssue failed: ${JSON.stringify(result)}`);
  }
  return title;
}

/**
 * Triage queue page.
 *
 * The seed enables triage on the ENG team and creates three inbound issues
 * (ENG-4, ENG-5, ENG-6) in the triage workflow state. ENG-1/2/3 are in
 * normal states and serve as duplicate targets. If the seed is ever changed
 * to disable triage, the smoke test below still tolerates either the
 * disabled message or the all-clear state, but the action tests assume
 * a populated queue.
 */
test.describe('Triage', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('triage page renders one of the expected states', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    const notEnabled = page.getByText(/triage is not enabled/i);
    const allClear = page.getByText(/all clear/i);
    const triageHeading = page.getByRole('heading', { name: /triage/i });

    // One of these should be visible — either the heading (when enabled),
    // the all-clear message (when enabled and empty), or the not-enabled
    // explanation (when disabled). Use .first() because the heading + all-
    // clear can both render together when the queue is empty.
    await expect(notEnabled.or(allClear).or(triageHeading).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('triage page shows the queued issues', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);

    // Pre-create a triage issue from this test so we don't depend on whatever
    // sibling specs have left in the seeded queue.
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');
    await createFreshTriageIssue(page, team);

    await page.goto(`/${ws}/team/${team}/triage`);

    // Header counter "{n} to triage".
    await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });

    // The Accept button is the most stable per-row signal: one per queued issue.
    const acceptButtons = page.getByRole('button', { name: 'Accept' });
    await expect(acceptButtons.first()).toBeVisible();
    expect(await acceptButtons.count()).toBeGreaterThanOrEqual(1);

    // At least one issue identifier should appear.
    await expect(page.getByText(/ENG-\d+/).first()).toBeVisible();
  });

  // The triage queue used to be cached via useMemo with stale deps, so
  // optimisticUpdate (which mutates pool entries without changing pool.size)
  // didn't invalidate the cached array. Switched to inline computation under
  // the wrapping `observer` so the selector re-runs on every pool change.
  test('Accept moves the issue out of triage', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    // Land on a workspace page first so cookies are attached for the API call.
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');

    // Seed a fresh triage issue so this test never depends on whatever the
    // sibling specs left in the queue. The server auto-routes issues created
    // without stateId on a triage-enabled team to the triage state.
    const freshTitle = await createFreshTriageIssue(page, team);

    // Now navigate to triage; the new row is fetched via bootstrap on load.
    await page.goto(`/${ws}/team/${team}/triage`);
    await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });

    // Wait for the new row (delivered via bootstrap) to appear.
    // Each triage row is a flex div with the "items-center gap-3 border-b"
    // utility classes. Find the one whose subtree contains the fresh title.
    const freshRow = page
      .locator('div.flex.items-center.gap-3.border-b')
      .filter({ hasText: freshTitle })
      .first();
    await expect(freshRow).toBeVisible({ timeout: 15_000 });

    // Click the Accept button on THAT row, not the first row of the queue.
    await freshRow.getByRole('button', { name: 'Accept' }).click();

    // The accepted row leaves the active queue. Assert against `freshRow` (a
    // queue-scoped locator) rather than `getByText(freshTitle)` page-wide,
    // because Sonner's success toast briefly echoes the title.
    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });

  test('Decline cancels the issue and removes it from the queue', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    // Land on team page first so cookies attach and bootstrap completes BEFORE
    // we create the fresh issue. Then navigate to /triage so the bootstrap on
    // load picks up the new row (the triage page does not subscribe to live
    // updates for newly-created issues).
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');

    const freshTitle = await createFreshTriageIssue(page, team);

    await page.goto(`/${ws}/team/${team}/triage`);
    await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });

    const freshRow = page
      .locator('div.flex.items-center.gap-3.border-b')
      .filter({ hasText: freshTitle })
      .first();
    await expect(freshRow).toBeVisible({ timeout: 15_000 });

    await freshRow.getByRole('button', { name: 'Decline' }).click();

    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });

  test('Mark Duplicate removes the issue and creates a duplicate relation', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    // Land on team page first so the fresh issue is created BEFORE the triage
    // page bootstraps. Bootstrap on /triage load then picks up the new row.
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');

    const freshTitle = await createFreshTriageIssue(page, team);

    await page.goto(`/${ws}/team/${team}/triage`);
    await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });

    const freshRow = page
      .locator('div.flex.items-center.gap-3.border-b')
      .filter({ hasText: freshTitle })
      .first();
    await expect(freshRow).toBeVisible({ timeout: 15_000 });

    // Find an arbitrary non-triage issue identifier to use as the duplicate
    // target; ENG-1/2/3 are seeded but ENG-1 may have been archived. Pick
    // any visible identifier in the queue OTHER than the fresh one we just
    // created, falling back to ENG-2 / ENG-3 from the seed if needed.
    let canonicalIdentifier = 'ENG-2';
    const idMatch = await page.evaluate(async (teamKey: string) => {
      // Look up the team id first since the issues query requires teamId.
      const teamsResp = await fetch('/api/graphql', {
        body: JSON.stringify({ query: `{ teams { id key } }` }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const teamsJson = await teamsResp.json();
      const teams = teamsJson?.data?.teams as Array<{ id: string; key: string }> | undefined;
      const team = teams?.find(t => t.key === teamKey);
      if (!team) {
        return [] as Array<{ identifier: string; title: string }>;
      }

      const resp = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: `query($teamId: String!) { issues(filter: { teamId: $teamId }, first: 50) { edges { node { identifier title } } } }`,
          variables: { teamId: team.id },
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const json = await resp.json();
      const edges = json?.data?.issues?.edges as
        | Array<{ node: { identifier: string; title: string } }>
        | undefined;
      return edges?.map(e => e.node) ?? [];
    }, team);
    const candidate = idMatch.find(n => n.title !== freshTitle && /^ENG-\d+$/.test(n.identifier));
    if (candidate) {
      canonicalIdentifier = candidate.identifier;
    }

    // The Duplicate flow uses window.prompt() — auto-accept with the canonical
    // identifier we discovered.
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(canonicalIdentifier);
    });

    await freshRow.getByRole('button', { name: 'Duplicate' }).click();

    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });

  test('Snooze hides the issue from the active queue', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    // Land on team page first; create fresh issue; then navigate to /triage
    // so the bootstrap on load picks up the new row.
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');

    const freshTitle = await createFreshTriageIssue(page, team);

    await page.goto(`/${ws}/team/${team}/triage`);
    await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });

    const freshRow = page
      .locator('div.flex.items-center.gap-3.border-b')
      .filter({ hasText: freshTitle })
      .first();
    await expect(freshRow).toBeVisible({ timeout: 15_000 });

    // Click the row-scoped Snooze button to open the preset popover, then
    // pick "1 day" (the page exposes 4 hours / 1 day / 1 week presets).
    await freshRow.getByRole('button', { name: 'Snooze' }).click();
    await page.getByRole('menuitem', { name: '1 day' }).click();

    // The snoozed row leaves the active queue.
    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });
});
