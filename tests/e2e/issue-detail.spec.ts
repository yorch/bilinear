import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Issue detail panel:
 *   - opens when an issue row is clicked
 *   - close button dismisses it
 *   - title can be edited inline
 *   - Shift+S toggles the issue subscription bell
 *
 * Relies on a seeded issue existing in the team's default issue list.
 */
test.describe('Issue Detail Panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('clicking an issue opens the detail panel with the identifier', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();
    // The panel header always renders the issue identifier (e.g. "ENG-1")
    await expect(panel.locator('text=/[A-Z]{1,10}-\\d+/')).toBeVisible();
  });

  test('Close button dismisses the panel', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: /close/i }).click();
    await expect(panel).not.toBeVisible();
  });

  test('inline title edit persists the change', async ({ page }) => {
    // Create a throwaway issue we are willing to mutate so we don't pollute
    // seeded data shared with other parallel tests.
    const original = `Detail edit ${Date.now()}`;
    await page.keyboard.press('c');
    await page.getByPlaceholder(/issue title/i).fill(original);
    await page.getByRole('button', { name: /^create issue$/i }).click();
    await expect(page.getByText(original)).toBeVisible({ timeout: 5_000 });

    await page.locator('[data-testid="issue-row"]', { hasText: original }).click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();

    const titleButton = panel.locator('button.text-xl').first();
    await expect(titleButton).toHaveText(original);
    await titleButton.click();

    const titleInput = panel.locator('input.text-xl');
    await expect(titleInput).toBeVisible();
    const updated = `${original} (edited)`;
    await titleInput.fill(updated);
    await titleInput.press('Enter');

    // The button re-renders with the new value once the change is committed.
    await expect(panel.getByText(updated)).toBeVisible({ timeout: 5_000 });
  });

  test('Shift+S toggles the subscription bell aria label', async ({ page }) => {
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await firstRow.click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();

    // The bell button's aria-label flips between "Subscribe (Shift+S)" and
    // "Unsubscribe (Shift+S)". Wait for the initial state to settle.
    const bell = panel.locator('button[aria-label*="ubscribe"]');
    await expect(bell).toBeVisible({ timeout: 10_000 });
    const before = await bell.getAttribute('aria-label');

    await page.keyboard.press('Shift+s');

    await expect
      .poll(async () => bell.getAttribute('aria-label'), { timeout: 5_000 })
      .not.toBe(before);
  });
});
