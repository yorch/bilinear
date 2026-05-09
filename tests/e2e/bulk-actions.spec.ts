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
    // text node. `.last()` picks that innermost match.
    const row1 = page.locator('div', { has: page.getByText('ENG-1', { exact: true }) }).last();
    const row3 = page.locator('div', { has: page.getByText('ENG-3', { exact: true }) }).last();

    await row1.click();
    await row3.click();

    // The toolbar reports "<n> selected" and surfaces the bulk controls.
    await expect(page.getByText(/2 selected/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^archive$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^clear$/i })).toBeVisible();
  });

  test('bulk archive removes selected issues from the list', async ({ page }) => {
    const row1 = page.locator('div', { has: page.getByText('ENG-1', { exact: true }) }).last();
    const row3 = page.locator('div', { has: page.getByText('ENG-3', { exact: true }) }).last();

    await row1.click();
    await row3.click();
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    await page.getByRole('button', { name: /^archive$/i }).click();

    // Once the bulk action commits the selection clears and the toolbar
    // disappears — wait for that state before re-querying the list so we
    // don't race the optimistic store update.
    await expect(page.getByText(/\d+ selected/i)).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByText('ENG-1', { exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('ENG-3', { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test('bulk priority change moves selected issues into the new priority group', async ({
    page,
  }) => {
    // The backlog groups issues by priority, so re-prioritising the selected
    // rows moves them into a different group section. Seed state has ENG-1
    // (P2 = Medium) and ENG-3 (P0 = no priority) sitting in different groups,
    // so after a bulk "Set Urgent" both should land under the "Urgent" group.
    const row1 = page.locator('div', { has: page.getByText('ENG-1', { exact: true }) }).last();
    const row3 = page.locator('div', { has: page.getByText('ENG-3', { exact: true }) }).last();

    await row1.click();
    await row3.click();
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    // Priority buttons are icon-only; their accessible name comes from the
    // title attribute ("Set Urgent" / "Set High" / "Set Medium" / "Set Low").
    await page.getByRole('button', { name: /^Set Urgent$/i }).click();

    // Toolbar clears once the bulk priority operation commits.
    await expect(page.getByText(/\d+ selected/i)).toHaveCount(0, { timeout: 10_000 });

    // Both rows should now sit under the "Urgent" priority group section.
    const urgentGroup = page
      .locator('div')
      .filter({ has: page.getByText('Urgent', { exact: true }) })
      .first();
    await expect(urgentGroup.getByText('ENG-1', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(urgentGroup.getByText('ENG-3', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
