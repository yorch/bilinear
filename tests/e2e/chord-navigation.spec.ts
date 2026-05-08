import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Two-key chord shortcuts:
 *   - "g i" → navigate to /<workspace>/my-issues
 *   - "g n" → navigate to /<workspace>/inbox
 *
 * Chords are dispatched by `useChord('g', '<key>', ...)` in the team page,
 * so the user must be on a team route for the listener to be registered.
 */
test.describe('Chord Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('g, n navigates to the inbox', async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/inbox$/);
  });

  test('g, i navigates to my issues', async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(page).toHaveURL(/\/my-issues$/);
  });
});
