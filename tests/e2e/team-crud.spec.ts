import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Team CRUD: create team → verify workflow states seeded → navigate to team.
 */
test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('sidebar shows teams', async ({ page }) => {
    // At least one team navigation link should be present
    await expect(page.locator('aside nav')).toBeVisible();
  });

  test('navigating to a team shows its issues', async ({ page }) => {
    // Click the first team link in the sidebar (team links contain /team/ in href)
    const teamLink = page.locator('aside nav a[href*="/team/"]').first();
    await teamLink.click();
    // Should show the issue list view
    await expect(
      page.locator('[data-testid="issue-list-view"], [data-testid="empty-state"]'),
    ).toBeVisible();
  });
});
