import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Right-click context menu on an issue row: opens with archive/delete/open
 * actions, escape dismisses it.
 */
test.describe('Issue Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('right-click on issue row opens the context menu', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click({ button: 'right' });

    const menu = page.locator('[aria-label^="Actions for "]');
    await expect(menu).toBeVisible();
  });

  test('Escape closes the context menu', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click({ button: 'right' });
    const menu = page.locator('[aria-label^="Actions for "]');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });
});
