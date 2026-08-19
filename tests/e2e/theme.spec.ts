import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Theme toggle: the sidebar exposes a Light/Dark/System fieldset whose
 * buttons report their state via aria-pressed. Selecting Dark adds the
 * "dark" class to the `<html>` element (next-themes class strategy).
 */
test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('selecting the Dark theme button applies the dark class to <html>', async ({ page }) => {
    const darkBtn = page.locator('aside button[title="Dark"]');
    await expect(darkBtn).toBeVisible();
    await darkBtn.click();

    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(darkBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('selecting Light removes the dark class', async ({ page }) => {
    await page.locator('aside button[title="Dark"]').click();
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

    await page.locator('aside button[title="Light"]').click();
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });
});
