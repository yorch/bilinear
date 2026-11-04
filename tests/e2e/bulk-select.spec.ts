import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * X toggles the bulk-select checkbox on the currently-active issue (the one
 * highlighted by J/K) without moving the cursor. A second X unchecks it.
 */
test.describe('Bulk Selection', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('X toggles the checkbox on the active issue', async ({ page }) => {
    await page.keyboard.press('j'); // move the cursor to the first issue
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await expect(firstRow).toHaveAttribute('data-selected', 'true');
    const checkbox = firstRow.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    await page.keyboard.press('x'); // check it; the cursor stays put
    await expect(checkbox).toBeChecked();
    await expect(firstRow).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('x'); // uncheck
    await expect(checkbox).not.toBeChecked();
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
