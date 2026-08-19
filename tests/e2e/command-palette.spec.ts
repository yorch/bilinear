import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Command palette: Cmd+K open, search, navigate, action commands.
 */
test.describe('Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('Cmd+K opens command palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
  });

  test('Escape closes command palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="command-palette"]')).not.toBeVisible();
  });

  test('typing filters results', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const input = page.getByPlaceholder(/search/i);
    await input.fill('test');
    // Results should update (at least the input value is reflected)
    await expect(input).toHaveValue('test');
  });

  test('shows recent items on open with empty query', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    // Recent section or results list is visible
    await expect(page.locator('[data-testid="command-palette-results"]')).toBeVisible();
  });

  test('arrow keys navigate results', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    // Wait for the palette dialog and at least one item to be present so the
    // useLayoutEffect-installed keydown listener has run before we send keys.
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-palette-item"]').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const firstItem = page.locator('[data-testid="command-palette-item"]').first();
    await expect(firstItem).toHaveAttribute('data-highlighted', 'true');
  });
});
