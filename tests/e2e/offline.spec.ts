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

  test('status change made while offline syncs on reconnect', async ({ page, context }) => {
    await loginAs(page, 'e2e@test.local');

    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Select first issue and read its title
    await page.keyboard.press('j');
    const activeRow = page.locator('[data-testid="issue-row"][data-selected="true"]').first();
    await expect(activeRow).toBeVisible();
    const issueTitle = (await activeRow.locator('button.flex-1').textContent())?.trim();
    expect(issueTitle).toBeTruthy();

    // Go offline
    await context.setOffline(true);

    // Open status popover and pick "Done"
    await page.keyboard.press('s');
    const statusPopover = page.getByTestId('status-select-popover');
    await expect(statusPopover).toBeVisible();
    await statusPopover.getByText('Done', { exact: true }).click();
    await expect(statusPopover).not.toBeVisible();

    // Optimistic: issue is under the Done group locally
    const doneGroup = page
      .locator('[data-testid="group-section"]')
      .filter({ has: page.getByTestId('group-header').filter({ hasText: 'Done' }) })
      .filter({ hasText: issueTitle as string });
    await expect(doneGroup).toBeVisible({ timeout: 5000 });

    // Go back online
    await context.setOffline(false);

    // Server-confirmed after reload
    await page.reload();
    await page.waitForSelector('[data-testid="issue-list-view"]');
    const doneGroupAfterReload = page
      .locator('[data-testid="group-section"]')
      .filter({ has: page.getByTestId('group-header').filter({ hasText: 'Done' }) })
      .filter({ hasText: issueTitle as string });
    await expect(doneGroupAfterReload).toBeVisible({ timeout: 10000 });
  });

  test('archive made while offline syncs on reconnect', async ({ page, context }) => {
    await loginAs(page, 'e2e@test.local');

    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Read first issue title
    await page.keyboard.press('j');
    const activeRow = page.locator('[data-testid="issue-row"][data-selected="true"]').first();
    await expect(activeRow).toBeVisible();
    const issueTitle = (await activeRow.locator('button.flex-1').textContent())?.trim();
    expect(issueTitle).toBeTruthy();

    // Go offline
    await context.setOffline(true);

    // Archive via Backspace (selection is still on first issue)
    await page.keyboard.press('Backspace');

    // Optimistic: title is gone from the list
    await expect(page.getByText(issueTitle as string)).toHaveCount(0, { timeout: 5000 });

    // Go online
    await context.setOffline(false);

    // Reload — server-confirmed archive
    await page.reload();
    await page.waitForSelector('[data-testid="issue-list-view"]');
    await expect(page.getByText(issueTitle as string)).toHaveCount(0, { timeout: 10000 });
  });

  test('multiple mutations queued offline all apply', async ({ page, context }) => {
    await loginAs(page, 'e2e@test.local');

    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Pre-warm the create-issue modal so the lazy-loaded TipTap editor chunks
    // are fetched while still online.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    const ts = Date.now();
    const titles = [`Queue 1 ${ts}`, `Queue 2 ${ts}`, `Queue 3 ${ts}`];

    // Go offline
    await context.setOffline(true);

    // Create three issues while offline
    for (const title of titles) {
      await page.keyboard.press('c');
      await expect(dialog).toBeVisible();
      const titleInput = dialog.getByPlaceholder(/issue title/i);
      await titleInput.fill(title);
      await titleInput.press('Enter');
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });
    }

    // Go online
    await context.setOffline(false);

    // Reload — all three should still be visible (server-confirmed)
    await page.reload();
    await page.waitForSelector('[data-testid="issue-list-view"]');
    for (const title of titles) {
      await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
    }
  });
});
