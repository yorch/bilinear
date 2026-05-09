import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

/**
 * NOTE on UI scope (discovered while writing this spec):
 *
 * The default team-issues page (`/[workspace]/team/[key]`) does NOT render a
 * bulk-action toolbar. There, `selectedId` is a single string, J/K move the
 * active row, and X just toggles that single row's selection — only one issue
 * can be "active" at a time, so the original "two rows have data-selected=true
 * after J X J J X" scenario isn't achievable on that page.
 *
 * The bulk-action toolbar instead lives on the backlog page
 * (`/[workspace]/team/[key]/backlog`). There, selection works by clicking
 * anywhere on a row (no checkbox; no J/K/X). When ≥1 row is selected the
 * toolbar shows:
 *   - four icon buttons "Set Urgent / Set High / Set Medium / Set Low"
 *   - "Estimate" (opens a window.prompt — not exercised here)
 *   - "Archive"
 *   - "Clear"
 * There are no status, assignee, or delete bulk actions in the current UI,
 * so the "bulk status change" assertion in the original task description
 * has been replaced with an analogous "bulk priority change" assertion that
 * reflects the controls that actually ship.
 */
test.describe('Bulk Actions', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/backlog`);
    // Wait for at least one backlog row to render so click selectors don't race.
    await expect(page.getByText(/ENG-\d+/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('selecting two rows shows the bulk action toolbar', async ({ page }) => {
    // Backlog rows aren't tagged with data-testid="issue-row"; the row that
    // owns the click handler is the innermost div containing the identifier
    // text node. Discover whichever rows are present rather than hardcoding
    // ENG-1 / ENG-3, since sibling tests can archive those seeded issues.
    const idCells = page.locator('span', { hasText: /^ENG-\d+$/ });
    await expect(idCells.first()).toBeVisible({ timeout: 10_000 });
    expect(await idCells.count()).toBeGreaterThanOrEqual(2);
    const id1 = (await idCells.nth(0).textContent())?.trim() ?? '';
    const id2 = (await idCells.nth(1).textContent())?.trim() ?? '';
    const row1 = page.locator('div', { has: page.getByText(id1, { exact: true }) }).last();
    const row2 = page.locator('div', { has: page.getByText(id2, { exact: true }) }).last();

    await row1.click();
    await row2.click();

    // The toolbar reports "<n> selected" and surfaces the bulk controls.
    await expect(page.getByText(/2 selected/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^archive$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^clear$/i })).toBeVisible();
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

    const row1 = page.locator('div', { has: page.getByText(ids[0], { exact: true }) }).last();
    const row2 = page.locator('div', { has: page.getByText(ids[1], { exact: true }) }).last();

    await row1.click();
    await row2.click();
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    await page.getByRole('button', { name: /^archive$/i }).click();

    // Once the bulk action commits the selection clears and the toolbar
    // disappears — wait for that state before re-querying the list.
    await expect(page.getByText(/\d+ selected/i)).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByText(ids[0], { exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(ids[1], { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test('bulk priority change moves selected issues into the new priority group', async ({
    page,
  }) => {
    // The backlog groups issues by priority, so re-prioritising the selected
    // rows moves them into a different group section. Sibling tests may have
    // archived seeded ENG-1 / ENG-3, so we discover whichever issue
    // identifiers are currently present rather than hardcoding numbers.
    const idCells = page.locator('span', { hasText: /^ENG-\d+$/ });
    await expect(idCells.first()).toBeVisible({ timeout: 10_000 });
    const count = await idCells.count();
    expect(count).toBeGreaterThanOrEqual(2);
    const id1 = (await idCells.nth(0).textContent())?.trim() ?? '';
    const id2 = (await idCells.nth(1).textContent())?.trim() ?? '';
    expect(id1).toMatch(/^ENG-\d+$/);
    expect(id2).toMatch(/^ENG-\d+$/);

    const row1 = page.locator('div', { has: page.getByText(id1, { exact: true }) }).last();
    const row2 = page.locator('div', { has: page.getByText(id2, { exact: true }) }).last();

    await row1.click();
    await row2.click();
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    // Priority buttons are icon-only; the accessible label is on the title
    // attribute ("Set Urgent" / "Set High" / "Set Medium" / "Set Low") rather
    // than the button text content (which is the priority icon glyph).
    await page.locator('button[title="Set Urgent"]').click();

    // Toolbar clears once the bulk priority operation commits.
    await expect(page.getByText(/\d+ selected/i)).toHaveCount(0, { timeout: 10_000 });

    // Both rows should now sit under the "Urgent" priority group section.
    const urgentGroup = page
      .locator('div')
      .filter({ has: page.getByText('Urgent', { exact: true }) })
      .first();
    await expect(urgentGroup.getByText(id1, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(urgentGroup.getByText(id2, { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
