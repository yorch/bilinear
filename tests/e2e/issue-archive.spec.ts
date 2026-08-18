import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Issue archive flow: pressing Backspace (or Delete) on the selected issue
 * archives it. The archived issue is removed from the default list view.
 *
 * To avoid mutating seed-state and breaking subsequent tests we first create
 * a throwaway issue, archive it, then assert it disappears.
 */
test.describe('Issue Archive', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('Backspace archives the selected issue and removes it from the list', async ({ page }) => {
    const title = `Throwaway ${Date.now()}`;

    // Create a new issue we are willing to archive.
    await page.keyboard.press('c');
    await page.getByPlaceholder(/issue title/i).fill(title);
    await page.getByRole('button', { name: /^create issue$/i }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });

    // The optimistic create renders the row with identifier "ENG-…" until
    // the server response (or WS broadcast) replaces the temp id with the
    // real one. Selection-based shortcuts (Backspace) operate on the store
    // id; archiving while still pointing at the temp id no-ops once the
    // temp entry is replaced. Wait for the numeric identifier first.
    const row = page.locator('[data-testid="issue-row"]', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText(/ENG-\d+/)).toBeVisible({ timeout: 10_000 });

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
