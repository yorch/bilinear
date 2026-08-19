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
    await expect(page.getByRole('heading', { name: /^cycles$/i })).toBeVisible();
  });

  test('shows empty state or one of the cycle groups', async ({ page }) => {
    const empty = page.getByText(/no cycles yet/i);
    const group = page.getByText(/^(active|upcoming|completed)$/i).first();
    await expect(empty.or(group)).toBeVisible({ timeout: 15_000 });
  });
});
