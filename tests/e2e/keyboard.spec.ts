import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Global keyboard shortcuts: navigation, create, property changes, sidebar.
 */
test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('C opens create issue modal', async ({ page }) => {
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Cmd+B toggles sidebar collapse', async ({ page }) => {
    const sidebar = page.locator('aside');
    const initialWidth = await sidebar.evaluate(
      el => el.getBoundingClientRect().width,
    );

    await page.keyboard.press('Meta+b');
    const collapsedWidth = await sidebar.evaluate(
      el => el.getBoundingClientRect().width,
    );
    expect(collapsedWidth).toBeLessThan(initialWidth);

    await page.keyboard.press('Meta+b');
    const expandedWidth = await sidebar.evaluate(
      el => el.getBoundingClientRect().width,
    );
    expect(expandedWidth).toBeGreaterThan(collapsedWidth);
  });

  test('S opens status selector when issue is selected', async ({ page }) => {
    // Select first issue with J
    await page.keyboard.press('j');
    // Press S to open status selector
    await page.keyboard.press('s');
    await expect(
      page.locator('[data-testid="status-select-popover"]'),
    ).toBeVisible();
  });

  test('P opens priority selector when issue is selected', async ({ page }) => {
    await page.keyboard.press('j');
    await page.keyboard.press('p');
    await expect(
      page.locator('[data-testid="priority-select-popover"]'),
    ).toBeVisible();
  });
});
