import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Issue list view: group by status, expand/collapse, keyboard navigation.
 */
test.describe('Issue List View', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('issues are grouped by workflow state', async ({ page }) => {
    // Each group has a header with a status name
    const groups = page.locator('[data-testid="group-section"]');
    await expect(groups.first()).toBeVisible();
  });

  test('clicking group header collapses the group', async ({ page }) => {
    const firstGroup = page.locator('[data-testid="group-section"]').first();
    const header = firstGroup.locator('[data-testid="group-header"]');
    const rows = firstGroup.locator('[data-testid="issue-row"]');

    // Group starts expanded
    await expect(rows.first()).toBeVisible();

    await header.click();

    // Rows should be hidden
    await expect(rows.first()).not.toBeVisible();
  });

  test('J/K keys navigate between issues', async ({ page }) => {
    // Press J to select first issue
    await page.keyboard.press('j');
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await expect(firstRow).toHaveAttribute('data-selected', 'true');

    // Press J again to move to second
    await page.keyboard.press('j');
    const secondRow = page.locator('[data-testid="issue-row"]').nth(1);
    await expect(secondRow).toHaveAttribute('data-selected', 'true');

    // Press K to go back
    await page.keyboard.press('k');
    await expect(firstRow).toHaveAttribute('data-selected', 'true');
  });
});
