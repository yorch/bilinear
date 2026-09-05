import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { gqlInPage } from '../fixtures/graphql';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Bulk actions live in the shared `BulkActionBar`, mounted by `IssueListView`
 * on every list page (team issues, backlog, my issues, saved views). Rows are
 * added to the checked set through their checkbox (the row's own click opens
 * the detail panel / moves the active row). With ≥1 row checked the bar
 * reports "<n> selected" and offers Status / Priority / Assignee / Label
 * popovers, Archive, and a clear button.
 *
 * The backlog page used to carry its own toolbar with click-to-select rows
 * and icon-only "Set Urgent" buttons; it renders the shared list now, so this
 * spec drives the shared bar. Rows are discovered rather than hardcoded since
 * sibling tests archive the seeded issues.
 */

/** Check the row that carries `identifier` via its (hover-revealed) checkbox. */
async function checkRow(page: Page, identifier: string) {
  const row = page.locator('[data-testid="issue-row"]').filter({ hasText: identifier }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator('input[type="checkbox"]').click({ force: true });
}

/** Server-side read of one issue's priority, by identifier. */
async function priorityOf(page: Page, identifier: string): Promise<number> {
  const res = await gqlInPage<{ issue: { priority: number } }>(
    page,
    `query($id: ID!) { issue(id: $id) { priority } }`,
    { id: identifier },
  );
  expect(res.errors, `issue ${identifier} should be readable`).toBeUndefined();
  return res.data?.issue.priority ?? -1;
}

test.describe('Bulk Actions', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/backlog`);
    // Wait for at least one backlog row to render so click selectors don't race.
    await expect(page.getByText(/ENG-\d+/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('checking two rows shows the bulk action toolbar', async ({ page }) => {
    const idCells = page.locator('span', { hasText: /^ENG-\d+$/ });
    await expect(idCells.first()).toBeVisible({ timeout: 10_000 });
    expect(await idCells.count()).toBeGreaterThanOrEqual(2);
    const id1 = (await idCells.nth(0).textContent())?.trim() ?? '';
    const id2 = (await idCells.nth(1).textContent())?.trim() ?? '';

    await checkRow(page, id1);
    await checkRow(page, id2);

    // The bar reports "<n> selected" and surfaces the bulk controls.
    await expect(page.getByText(/2 selected/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^archive$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /clear selection/i })).toBeVisible();
  });

  test('bulk archive removes selected issues from the list', async ({ page }) => {
    // Pre-create two fresh issues to archive via the team-page C modal (the
    // modal explicitly sends stateId = team.defaultIssueStateId, bypassing the
    // server's triage auto-route that fires when stateId is omitted on a
    // triage-enabled team). Going through the API directly would put the
    // issues in the Triage state and they wouldn't appear in the backlog.
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    const ts = Date.now();
    const titles = [`Bulk archive A ${ts}`, `Bulk archive B ${ts}`];
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"]');
    for (const title of titles) {
      await page.keyboard.press('c');
      const dialog = page.getByRole('dialog', { name: /create issue/i });
      await expect(dialog).toBeVisible();
      const titleInput = dialog.getByPlaceholder(/issue title/i);
      await titleInput.fill(title);
      await titleInput.press('Enter');
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
    }
    // Read the freshly-assigned identifiers from the team page.
    const ids: string[] = [];
    for (const title of titles) {
      const row = page.locator('[data-testid="issue-row"]').filter({ hasText: title }).first();
      await expect(row.getByText(/^ENG-\d+$/)).toBeVisible({ timeout: 10_000 });
      ids.push(((await row.getByText(/^ENG-\d+$/).textContent()) ?? '').trim());
    }
    // Navigate to the backlog where the bulk-action toolbar lives.
    await page.goto(`/${ws}/team/${team}/backlog`);
    await expect(page.getByText(ids[0], { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ids[1], { exact: true })).toBeVisible({ timeout: 10_000 });

    await checkRow(page, ids[0] ?? '');
    await checkRow(page, ids[1] ?? '');
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    await page.getByRole('button', { name: /^archive$/i }).click();

    // Once the bulk action commits the selection clears and the toolbar
    // disappears — wait for that state before re-querying the list.
    await expect(page.getByText(/\d+ selected/i)).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByText(ids[0], { exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(ids[1], { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test('bulk priority change sets every checked issue to the chosen priority', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/backlog`);
    await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]');

    const idCells = page.locator('span', { hasText: /^ENG-\d+$/ });
    await expect(idCells.first()).toBeVisible({ timeout: 10_000 });
    expect(await idCells.count()).toBeGreaterThanOrEqual(2);
    const id1 = (await idCells.nth(0).textContent())?.trim() ?? '';
    const id2 = (await idCells.nth(1).textContent())?.trim() ?? '';
    expect(id1).toMatch(/^ENG-\d+$/);
    expect(id2).toMatch(/^ENG-\d+$/);

    await checkRow(page, id1);
    await checkRow(page, id2);
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    // Priority is a popover on the bar; pick Urgent (priority 1).
    await page.getByRole('button', { name: /^priority$/i }).click();
    await page.getByRole('button', { name: /^urgent$/i }).click();

    // The bar clears once the bulk operation is enqueued.
    await expect(page.getByText(/\d+ selected/i)).toHaveCount(0, { timeout: 10_000 });

    // Assert the post-state on the server, not the grouping: the backlog
    // groups by state, so a priority change does not move rows.
    await expect.poll(() => priorityOf(page, id1), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => priorityOf(page, id2), { timeout: 10_000 }).toBe(1);
  });
});
