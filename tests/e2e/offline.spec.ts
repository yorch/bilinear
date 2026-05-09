import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Offline support: go offline → create issue → go online → verify synced.
 */
test.describe('Offline Support', () => {
  test('issues can be created while offline and sync on reconnect', async ({ page, context }) => {
    await loginAs(page, 'e2e@test.local');

    // Wait for initial bootstrap
    await page.waitForSelector('[data-testid="issue-list-view"]');

    const title = `Offline issue ${Date.now()}`;

    // Go offline
    await context.setOffline(true);

    // Create issue offline. Wait for the modal explicitly so we don't race
    // its mount, and scope the placeholder + submit lookups to the dialog
    // (otherwise /create/i can match the sidebar "Create a team" affordance).
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/issue title/i).fill(title);
    await dialog.getByRole('button', { exact: true, name: 'Create issue' }).click();

    // Optimistic update: issue appears immediately in local MobX store
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });

    // Go back online
    await context.setOffline(false);

    // Wait for sync to complete — issue should still be visible (confirmed by server)
    await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
  });
});
