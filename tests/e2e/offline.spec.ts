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

    // Pre-warm the create-issue modal so the lazy-loaded TipTap editor
    // chunks (JS + CSS) are fetched while we're still online — opening
    // the modal for the first time after setOffline(true) would trip a
    // ChunkLoadError and unmount the dialog via the workspace error
    // boundary. Wait for the ProseMirror node to render so we know the
    // editor module finished resolving before we close the modal.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    const title = `Offline issue ${Date.now()}`;

    // Go offline
    await context.setOffline(true);

    // Create issue offline. Submit via Enter on the title input — the
    // submit button can disappear momentarily when MobX-derived props
    // re-render the modal.
    await page.keyboard.press('c');
    await expect(dialog).toBeVisible();
    const titleInput = dialog.getByPlaceholder(/issue title/i);
    await titleInput.fill(title);
    await titleInput.press('Enter');

    // Optimistic update: issue appears immediately in local MobX store
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });

    // Go back online
    await context.setOffline(false);

    // Wait for sync to complete — issue should still be visible (confirmed by server)
    await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
  });
});
