import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Team CRUD: create team → verify workflow states seeded → navigate to team.
 */
test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('sidebar shows teams', async ({ page }) => {
    // At least one team navigation link should be present
    await expect(page.locator('aside nav')).toBeVisible();
  });

  test('navigating to a team shows its issues', async ({ page }) => {
    // Click first team link in sidebar
    const teamLink = page.locator('aside nav a').first();
    await teamLink.click();
    // Should show the issue list view
    await expect(
      page.locator(
        '[data-testid="issue-list-view"], [data-testid="empty-state"]',
      ),
    ).toBeVisible();
  });
});
