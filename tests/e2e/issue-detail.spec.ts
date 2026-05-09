import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Issue detail panel:
 *   - opens when an issue row's title is clicked
 *   - close button dismisses it
 *   - title can be edited inline
 *   - Shift+S toggles the issue subscription bell
 *
 * Pin selection to a seeded issue ("Set up CI/CD pipeline") so the test
 * doesn't race against parallel specs that create their own issues — using
 * `.first()` would otherwise click whichever throwaway happens to lead the
 * sort order at the moment the test runs.
 *
 * Click the title button (not the row container) — the row's div has no
 * onClick of its own; only the title button triggers `onOpen`. Clicking
 * the row at its visual center can land on a sibling control (priority,
 * label, due-date) and silently miss the navigation.
 */
const SEED_TITLE = 'Set up CI/CD pipeline';

const titleButton = (page: Page, title: string): Locator =>
  page
    .locator('[data-testid="issue-row"]', { hasText: title })
    .getByRole('button', { exact: true, name: title });

test.describe('Issue Detail Panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('clicking an issue opens the detail panel with the identifier', async ({ page }) => {
    await titleButton(page, SEED_TITLE).click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();
    // The panel header always renders the issue identifier (e.g. "ENG-1")
    await expect(panel.locator('text=/[A-Z]{1,10}-\\d+/')).toBeVisible();
  });

  test('Close button dismisses the panel', async ({ page }) => {
    await titleButton(page, SEED_TITLE).click();
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

    await titleButton(page, original).click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();

    const titleHeading = panel.locator('button.text-xl').first();
    await expect(titleHeading).toHaveText(original);
    await titleHeading.click();

    const titleInput = panel.locator('input.text-xl');
    await expect(titleInput).toBeVisible();
    const updated = `${original} (edited)`;
    await titleInput.fill(updated);
    await titleInput.press('Enter');

    // The button re-renders with the new value once the change is committed.
    await expect(panel.getByText(updated)).toBeVisible({ timeout: 5_000 });
  });

  test('Shift+S toggles the subscription bell aria label', async ({ page }) => {
    await titleButton(page, SEED_TITLE).click();
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
