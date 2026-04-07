import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Issue CRUD critical path:
 *   create issue → verify in list → edit fields → archive
 */
test.describe('Issue CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('C shortcut opens create-issue modal', async ({ page }) => {
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByPlaceholder(/issue title/i)).toBeVisible();
  });

  test('create issue and verify it appears in list', async ({ page }) => {
    const title = `Test issue ${Date.now()}`;

    // Open modal and create
    await page.keyboard.press('c');
    await page.getByPlaceholder(/issue title/i).fill(title);
    await page.getByRole('button', { name: /create/i }).click();

    // Issue should appear in the list
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });
  });

  test('clicking issue identifier opens detail panel', async ({ page }) => {
    // Assumes at least one issue exists from seed
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click();
    await expect(
      page.locator('[data-testid="issue-detail-panel"]'),
    ).toBeVisible();
  });

  test('escape closes detail panel', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('[data-testid="issue-detail-panel"]'),
    ).not.toBeVisible();
  });
});
