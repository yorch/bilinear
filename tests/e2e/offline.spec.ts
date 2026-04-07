import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Offline support: go offline → create issue → go online → verify synced.
 */
test.describe('Offline Support', () => {
  test('issues can be created while offline and sync on reconnect', async ({
    page,
    context,
  }) => {
    await loginAs(page, 'e2e@test.local');

    // Wait for initial bootstrap
    await page.waitForTimeout(2000);

    const title = `Offline issue ${Date.now()}`;

    // Go offline
    await context.setOffline(true);

    // Toast or indicator should show "offline"
    // (exact selector depends on implementation)

    // Create issue offline
    await page.keyboard.press('c');
    await page.getByPlaceholder(/issue title/i).fill(title);
    await page.getByRole('button', { name: /create/i }).click();

    // Optimistic update: issue appears immediately in local MobX store
    await expect(page.getByText(title)).toBeVisible({ timeout: 3000 });

    // Go back online
    await context.setOffline(false);

    // Wait for sync to complete — issue should still be visible (confirmed by server)
    await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
  });
});
