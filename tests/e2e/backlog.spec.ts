import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Team backlog: the page lists only issues in backlog-category workflow states.
 * The seed puts ENG-7..9 in `Backlog` (ENG-1..3 are Todo/In Progress and
 * ENG-4..6 are Triage, so they do not appear here).
 */
test.describe('Backlog', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/backlog`);
  });

  test('navigates to the backlog URL', async ({ page }) => {
    await expect(page).toHaveURL(/\/team\/[^/]+\/backlog$/);
  });

  test('renders without runtime error', async ({ page }) => {
    // Assert that a Next.js error overlay isn't shown rather than tying the
    // test to specific copy that may evolve.
    await expect(page.locator('text=Application error')).toHaveCount(0);
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);
  });

  test('lists the seeded backlog issues and not Todo or Triage ones', async ({ page }) => {
    await expect(page.getByText('ENG-7', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('ENG-8', { exact: true })).toBeVisible();
    await expect(page.getByText('ENG-3', { exact: true })).toHaveCount(0);
    await expect(page.getByText('ENG-4', { exact: true })).toHaveCount(0);
  });
});
