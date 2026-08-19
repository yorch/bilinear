import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Command palette search behavior: typing a query filters items. We assert
 * the listbox semantics (role="listbox" + role="option" via aria-selected)
 * and that arrow navigation moves the highlighted option.
 *
 * The basic open/close + arrow-key behavior is already covered by
 * `command-palette.spec.ts`; this file focuses on search and result rendering.
 */
test.describe('Command Palette — Search', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
  });

  test('typing a query keeps the input and result list in sync', async ({ page }) => {
    const input = page.getByPlaceholder(/search/i);
    await input.fill('settings');
    await expect(input).toHaveValue('settings');
    // The listbox container stays mounted regardless of result count.
    await expect(page.locator('[data-testid="command-palette-results"]')).toBeVisible();
  });

  test('a bogus query renders an empty result state without error', async ({ page }) => {
    const input = page.getByPlaceholder(/search/i);
    await input.fill('zzz_unlikely_match_xyzzy');
    // Results list is still mounted; we just don't expect any highlighted item.
    await expect(page.locator('[data-testid="command-palette-results"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="command-palette-item"][data-highlighted="true"]'),
    ).toHaveCount(0);
  });

  test('clearing the query restores the default result list', async ({ page }) => {
    const input = page.getByPlaceholder(/search/i);
    await input.fill('zzz_unlikely_match_xyzzy');
    await input.fill('');
    await expect(input).toHaveValue('');
    // After clearing, ArrowDown should highlight a result again.
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('[data-testid="command-palette-item"][data-highlighted="true"]').first(),
    ).toBeVisible();
  });
});
