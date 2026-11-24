import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Create a fresh issue on a triage-enabled team without an explicit stateId.
 * The server's triage routing (issue.service.ts:93–108) auto-routes the
 * resulting issue to the team's triage workflow state, so this issue then
 * appears on /team/<key>/triage. We POST directly to /api/graphql via the
 * page context so the auth cookies tag along.
 *
 * Returns the title that was used so the caller can locate the new row.
 */
async function createFreshTriageIssue(
  page: Page,
  teamKey: string,
  explicitTitle?: string,
): Promise<string> {
  const title =
    explicitTitle ?? `Triage action ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
 * Select a queue row and return the preview pane's action toolbar.
 *
 * Triage is a two-pane review: clicking a row focuses that issue, and the
 * single Accept / Decline / Duplicate / Snooze group acts on whatever the
 * preview is showing. These specs used to click a button inside the row itself,
 * back when every row carried its own copy of all four.
 */
async function focusTriageRow(page: Page, title: string) {
  const row = page.getByTestId('triage-row').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  // The preview renders the focused issue's title as a heading, so waiting on
  // it proves the click landed before any action is taken.
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 });
  return row;
}

/** Distinctive, FTS-friendly word so suggestion tests only match their own issues. */
function uniqueWord(): string {
  return `quokka${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Create the issues on the team page first, then land on /triage (bootstrap picks them up). */
async function openTriageWith(page: Page, titles: string[]): Promise<void> {
  const ws = getWorkspaceKey(page);
  const team = getTeamKey(page);
  await page.goto(`/${ws}/team/${team}`);
  await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');
  for (const title of titles) {
    await createFreshTriageIssue(page, team, title);
  }
  await page.goto(`/${ws}/team/${team}/triage`);
  await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });
  // The Accept button only renders once an issue is focused, i.e. the page's
  // hotkeys are bound; waiting on it avoids the press-before-bind window.
  await expect(page.getByRole('button', { exact: true, name: 'Accept' })).toBeEnabled();
}

const rowOf = (page: Page, title: string) =>
  page.getByTestId('triage-row').filter({ hasText: title });

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
    await openWorkspace(page);
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

    // One Accept button, in the preview pane, acting on the focused issue.
    await expect(page.getByRole('button', { exact: true, name: 'Accept' })).toBeVisible();
    // …and one row per queued issue.
    expect(await page.getByTestId('triage-row').count()).toBeGreaterThanOrEqual(1);

    // At least one issue identifier should appear.
    await expect(page.getByText(/ENG-\d+/).first()).toBeVisible();
  });

  // The four action tests below were `.fixme` from 2026-05-12, blamed on a
  // "WebSocket reconcile race under CI load" that never reproduced. They are
  // live again: 3× repeat-each plus two full CI-shaped runs (CI=1,
  // --workers=1, --retries=0) are green, and the two things the old notes
  // actually described are both accounted for.
  //
  // The row locator was `div.flex.items-center.gap-3.border-b` — the row's
  // Tailwind utility list. That is not a contract: any `cn()` edit on the row
  // silently stops it matching, and "no such element" reads as "row still
  // visible" only until you look at which assertion failed. It is now
  // `data-testid="triage-row"`.
  //
  // The other half is shared with `sync.spec.ts` and `offline.spec.ts`: these
  // specs leave their `createFreshTriageIssue` rows behind, the team issue
  // list virtualizes past 20 rows per group, and past that a just-created row
  // is not in the DOM to be found. That is why results moved when unrelated
  // `.fixme` lines changed how many issues earlier specs created. The
  // `cleanup` teardown project now archives them — see
  // `.claude/rules/testing.md`.
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
    // Focus THAT issue, not whatever the queue happens to show first.
    const freshRow = await focusTriageRow(page, freshTitle);

    await page.getByRole('button', { exact: true, name: 'Accept' }).click();

    // The accepted row leaves the active queue. Assert against `freshRow` (a
    // queue-scoped locator) rather than `getByText(freshTitle)` page-wide,
    // because Sonner's success toast briefly echoes the title.
    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });

  // See the note above `Accept moves the issue out of triage`.
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

    const freshRow = await focusTriageRow(page, freshTitle);

    await page.getByRole('button', { exact: true, name: 'Decline' }).click();

    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });

  // See the note above `Accept moves the issue out of triage`. This one and
  // Snooze were held back one round longer than Accept/Decline on the theory
  // that creating a relation (here) or routing through a sub-popover (Snooze)
  // widened the same race. They share the row locator, which is the part that
  // was actually wrong.
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

    const freshRow = await focusTriageRow(page, freshTitle);

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
          query: `query($teamId: ID!) { issues(filter: { teamId: $teamId }, first: 50) { edges { node { identifier title } } } }`,
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

    // The Duplicate flow opens a searchable issue picker — search by
    // identifier and pick the matching result.
    await page.getByRole('button', { exact: true, name: 'Duplicate' }).click();
    await page.getByRole('combobox').fill(canonicalIdentifier);
    await page
      .getByRole('option', { name: new RegExp(canonicalIdentifier) })
      .first()
      .click();

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

    const freshRow = await focusTriageRow(page, freshTitle);

    // Open the preset popover from the preview toolbar, then pick "1 day"
    // (the page exposes 4 hours / 1 day / 1 week presets).
    await page.getByRole('button', { exact: true, name: 'Snooze' }).click();
    await page.getByRole('option', { name: '1 day' }).click();

    // The snoozed row leaves the active queue.
    await expect(freshRow).not.toBeVisible({ timeout: 10_000 });
  });

  // Keyboard flow. Titles are unique per test so neither the suggestion list
  // (which matches on shared words) nor `getByRole` name matching can collide
  // with rows other specs left behind.
  test('1 accepts the focused issue, offers Undo, and Undo returns it to the queue', async ({
    page,
  }) => {
    const word = uniqueWord();
    const title = `${word} keyboard accept`;
    await openTriageWith(page, [title]);
    await focusTriageRow(page, title);

    await page.keyboard.press('1');
    await expect(rowOf(page, title)).toHaveCount(0, { timeout: 10_000 });
    const toast = page.getByText(/Accepted ENG-\d+/);
    await expect(toast).toBeVisible();

    await page.getByRole('button', { exact: true, name: 'Undo' }).click();
    await expect(rowOf(page, title)).toHaveCount(1, { timeout: 10_000 });
  });

  test('3 declines and focus moves to the next row; J and K move the focus', async ({ page }) => {
    const word = uniqueWord();
    const first = `${word} alpha first`;
    await openTriageWith(page, [first, `${word} beta second`, `${word} gamma third`]);
    const firstRow = await focusTriageRow(page, first);
    // Tests in this file run in parallel against one shared team queue, so
    // another test's issue can land between ours. Resolve "the next row" from
    // the DOM instead of assuming it is our second issue.
    const nextRow = firstRow.locator(
      'xpath=following-sibling::button[@data-testid="triage-row"][1]',
    );
    await expect(nextRow).toBeVisible();
    // Identify it by issue key: the row's relative timestamp ("just now") changes.
    const nextKey = (await nextRow.innerText()).match(/[A-Z]+-\d+/)?.[0];
    expect(nextKey).toBeTruthy();
    const sameNext = page
      .getByTestId('triage-row')
      .filter({ hasText: new RegExp(`${nextKey}(?!\\d)`) });

    await page.keyboard.press('j');
    await expect(sameNext).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('k');
    await expect(rowOf(page, first)).toHaveAttribute('aria-current', 'true');

    await page.keyboard.press('3');
    await expect(rowOf(page, first)).toHaveCount(0, { timeout: 10_000 });
    // Focus lands on the following row, not back at the top of the queue.
    await expect(sameNext).toHaveAttribute('aria-current', 'true');
  });

  test('decision keys do nothing while the shortcut help dialog is open', async ({ page }) => {
    const title = `${uniqueWord()} behind modal`;
    await openTriageWith(page, [title]);
    await focusTriageRow(page, title);

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('3');
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
    await expect(rowOf(page, title)).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  test('the snooze menu opens with H and picks with the keyboard', async ({ page }) => {
    const title = `${uniqueWord()} snooze by key`;
    await openTriageWith(page, [title]);
    await focusTriageRow(page, title);

    await page.keyboard.press('h');
    await expect(page.getByRole('option', { name: '1 day' })).toBeVisible();
    await page.getByRole('option', { name: '1 day' }).click();
    await expect(rowOf(page, title)).toHaveCount(0, { timeout: 10_000 });
  });

  test('lists possible duplicates, including a peer still in triage, and resolves one', async ({
    page,
  }) => {
    const word = uniqueWord();
    const peer = `${word} export fails on large files`;
    const source = `${word} export fails on large uploads`;
    await openTriageWith(page, [peer, source]);
    await focusTriageRow(page, source);

    const suggestions = page.getByRole('region', { name: 'Possible duplicates' });
    await expect(suggestions).toBeVisible({ timeout: 20_000 });
    const item = suggestions.getByTestId('triage-duplicate-suggestion').filter({ hasText: peer });
    await expect(item).toHaveCount(1);
    await expect(item.getByText('In triage')).toBeVisible();

    await item.getByRole('button', { name: /Mark as duplicate of ENG-\d+/ }).click();
    await expect(rowOf(page, source)).toHaveCount(0, { timeout: 10_000 });
    // The peer it was resolved against stays in the queue.
    await expect(rowOf(page, peer)).toHaveCount(1);
  });
});
