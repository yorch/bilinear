import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * X toggles the selection state on the currently-active issue (the one
 * highlighted by J/K). A second X clears it.
 */
test.describe('Bulk Selection', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('X clears selection on the active issue', async ({ page }) => {
    await page.keyboard.press('j'); // select first issue
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await expect(firstRow).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('x'); // toggle off
    await expect(firstRow).not.toHaveAttribute('data-selected', 'true');
  });

  test('clicking the row checkbox toggles selection without opening detail', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    const checkbox = firstRow.locator('input[type="checkbox"]');
    // The checkbox is opacity-0 until hover/focus; force the click since
    // headless tests don't always trigger the hover state reliably.
    await checkbox.click({ force: true });
    // On the team page the checkbox is in bulk-mode: click adds the issue to
    // the checked set (checkbox becomes checked), but does NOT open the detail
    // panel or change keyboard-nav selection (data-selected).
    await expect(checkbox).toBeChecked();
    await expect(page.locator('[data-testid="issue-detail-panel"]')).toHaveCount(0);
  });
});
