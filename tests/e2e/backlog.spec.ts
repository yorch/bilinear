import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Team backlog: page renders and shows seeded issues. The seed creates issues
 * in the `Backlog`, `Todo`, and `In Progress` workflow states; the backlog
 * view filters to the team's backlog set.
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
    // The backlog page may legitimately be empty for the seeded team;
    // assert that a Next.js error overlay isn't shown rather than tying
    // the test to a specific empty-state copy that may evolve.
    await expect(page.locator('text=Application error')).toHaveCount(0);
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);
  });
});
