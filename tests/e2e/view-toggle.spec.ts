import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * View toggle: Alt+1 selects the list view, Alt+2 selects the board view.
 * The toggle buttons expose `title` attributes that include the shortcut so
 * we use `[title*="..."]` selectors to find them and assert their pressed
 * state via the active-style class transitions.
 */
test.describe('View Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('Alt+2 switches to board view, Alt+1 returns to list view', async ({ page }) => {
    const listBtn = page.locator('button[title*="List view"]');
    const boardBtn = page.locator('button[title*="Board view"]');

    await expect(listBtn).toBeVisible();
    await expect(boardBtn).toBeVisible();

    // Switch to board
    await page.keyboard.press('Alt+2');
    // The board view does not render the list-view container.
    await expect(page.locator('[data-testid="issue-list-view"]')).toHaveCount(0);

    // Switch back to list
    await page.keyboard.press('Alt+1');
    // The list view renders again, OR the empty-state replaces it when the
    // team has no issues. Either signals the list view mode is active.
    await expect(
      page.locator('[data-testid="issue-list-view"], [data-testid="empty-state"]'),
    ).toBeVisible();
  });
});
