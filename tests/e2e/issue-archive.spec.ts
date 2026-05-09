import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Issue archive flow: pressing Backspace (or Delete) on the selected issue
 * archives it. The archived issue is removed from the default list view.
 *
 * To avoid mutating seed-state and breaking subsequent tests we first create
 * a throwaway issue, archive it, then assert it disappears.
 */
test.describe('Issue Archive', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('Backspace archives the selected issue and removes it from the list', async ({ page }) => {
    const title = `Throwaway ${Date.now()}`;

    // Create a new issue we are willing to archive.
    await page.keyboard.press('c');
    await page.getByPlaceholder(/issue title/i).fill(title);
    await page.getByRole('button', { name: /^create issue$/i }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });

    // Find the row, select it, archive with Backspace.
    const row = page.locator('[data-testid="issue-row"]', { hasText: title });
    // Hover to surface the checkbox, then click it to mark this row as selected.
    await row.locator('input[type="checkbox"]').click({ force: true });
    await expect(row).toHaveAttribute('data-selected', 'true');

    // useHotkeys('backspace', …) is registered on the window but ignores
    // events whose target is an INPUT/TEXTAREA — clicking the row checkbox
    // leaves focus on it, so we blur before sending the shortcut.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Backspace');

    // After archive, the row should disappear from the default list.
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 10_000 });
  });
});
