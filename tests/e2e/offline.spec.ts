import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Offline support: go offline → create issue → go online → verify synced.
 */
test.describe('Offline Support', () => {
  test('issues can be created while offline and sync on reconnect', async ({ page, context }) => {
    await openWorkspace(page);

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

  // TransactionQueue persists each enqueue to IndexedDB and resumes on the
  // next page load via TransactionQueue.hydrate(). The retry counter resets
  // on hydrate so a long offline window followed by a reload still drains.
  test('status change made while offline syncs on reconnect', async ({ page, context }) => {
    await openWorkspace(page);

    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Pre-warm the create-issue modal so the lazy-loaded TipTap editor chunks
    // are fetched while we're still online — opening the modal for the first
    // time after setOffline(true) would trip a ChunkLoadError.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Create a fresh issue to operate on so we don't rely on whichever issue
    // is at the top of the list (sibling specs may have moved seeded issues
    // into Done already, in which case picking "Done" would be a no-op).
    const issueTitle = `Offline status ${Date.now()}`;
    await page.keyboard.press('c');
    await expect(dialog).toBeVisible();
    const titleInput = dialog.getByPlaceholder(/issue title/i);
    await titleInput.fill(issueTitle);
    await titleInput.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 10_000 });

    // Wait for the optimistic temp identifier (suffix '…') to reconcile to
    // the real ENG-N. If we click the checkbox on the temp-id row, the
    // page's selectedId gets set to that temp id and is then orphaned when
    // the issue-store atomically swaps the placeholder for the real issue.
    const freshRow = page
      .locator('[data-testid="issue-row"]')
      .filter({ hasText: issueTitle })
      .first();
    await expect(freshRow.getByText(/^ENG-\d+$/)).toBeVisible({ timeout: 10_000 });

    // Select via the hidden checkbox — clicking the row falls onto the title
    // button and opens the detail panel.
    await freshRow.locator('input[type="checkbox"]').click({ force: true });
    await expect(freshRow).toHaveAttribute('data-selected', 'true');
    // Blur the checkbox so subsequent keyboard shortcuts (S, Backspace) are not
    // swallowed by useHotkeys' INPUT-target gating.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

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
      .filter({ hasText: issueTitle });
    await expect(doneGroup).toBeVisible({ timeout: 5000 });

    // Go back online
    await context.setOffline(false);

    // Server-confirmed after reload
    await page.reload();
    await page.waitForSelector('[data-testid="issue-list-view"]');
    const doneGroupAfterReload = page
      .locator('[data-testid="group-section"]')
      .filter({ has: page.getByTestId('group-header').filter({ hasText: 'Done' }) })
      .filter({ hasText: issueTitle });
    await expect(doneGroupAfterReload).toBeVisible({ timeout: 10000 });
  });

  test('archive made while offline syncs on reconnect', async ({ page, context }) => {
    await openWorkspace(page);

    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Pre-warm the create-issue modal so the lazy-loaded TipTap editor chunks
    // are fetched while we're still online.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Create a fresh issue to archive so we don't depend on the seed state
    // (sibling specs may have already archived the seeded ENG-* issues).
    const issueTitle = `Offline archive ${Date.now()}`;
    await page.keyboard.press('c');
    await expect(dialog).toBeVisible();
    const titleInput = dialog.getByPlaceholder(/issue title/i);
    await titleInput.fill(issueTitle);
    await titleInput.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 10_000 });

    // Wait for the optimistic temp identifier (suffix '…') to reconcile to
    // the real ENG-N before clicking the checkbox. Clicking on the temp-id row
    // sets selectedId to the temp id which is then orphaned when the store
    // atomically swaps the placeholder for the real issue.
    const freshRow = page
      .locator('[data-testid="issue-row"]')
      .filter({ hasText: issueTitle })
      .first();
    await expect(freshRow.getByText(/^ENG-\d+$/)).toBeVisible({ timeout: 10_000 });

    // Focus the fresh row via its hidden checkbox — clicking the row falls
    // onto the title button and opens the detail panel.
    await freshRow.locator('input[type="checkbox"]').click({ force: true });
    await expect(freshRow).toHaveAttribute('data-selected', 'true');
    // Blur the checkbox so subsequent keyboard shortcuts (S, Backspace) are not
    // swallowed by useHotkeys' INPUT-target gating.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Go offline
    await context.setOffline(true);

    // Archive via Backspace
    await page.keyboard.press('Backspace');

    // Optimistic: title is gone from the list
    await expect(page.getByText(issueTitle)).toHaveCount(0, { timeout: 5000 });

    // Go online
    await context.setOffline(false);

    // Reload — server-confirmed archive
    await page.reload();
    await page.waitForSelector('[data-testid="issue-list-view"]');
    await expect(page.getByText(issueTitle)).toHaveCount(0, { timeout: 10000 });
  });

  // Pending transactions persist to IndexedDB so multiple offline writes
  // survive a page reload and drain serially after hydrate().
  //
  // `.fixme` from 2026-05-12 for an "optimistic title not visible after
  // dialog close" flake blamed on CI-load-induced React commit delay. Live
  // again: green 3× under repeat-each and across two full CI-shaped runs
  // (CI=1, --workers=1, --retries=0).
  //
  // This test creates three issues in one go, so it is the first to notice
  // when the team list crosses `GroupSection`'s 20-row virtualization
  // threshold — past that the newest rows are not in the DOM at all and
  // `getByText(title)` cannot find them. Keeping the list under that
  // threshold is what the `cleanup` teardown project is for; see
  // `.claude/rules/testing.md`.
  test('multiple mutations queued offline all apply', async ({ page, context }) => {
    await openWorkspace(page);

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
