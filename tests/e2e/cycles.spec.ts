import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Cycles: page renders for the seeded team, with the heading visible and
 * either an empty-state or one of the cycle status groups.
 */
test.describe('Cycles', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/cycles`);
  });

  test('cycles heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /cycles$/i })).toBeVisible();
  });

  test('shows empty state or one of the cycle groups', async ({ page }) => {
    const empty = page.getByText(/no cycles yet/i);
    // The Active/Archived switcher also has an "Active" control, so a group
    // header is identified by its disclosure semantics (aria-expanded).
    const group = page
      .locator('button[aria-expanded]')
      .filter({ hasText: /^(active|upcoming|completed)\b/i })
      .first();
    await expect(empty.or(group)).toBeVisible({ timeout: 15_000 });
  });
});
