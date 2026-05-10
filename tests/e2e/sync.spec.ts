import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Sync: create issue in one tab → verify it appears in another tab.
 * This validates the real-time WebSocket broadcast and delta sync path.
 */
test.describe('Real-time Sync', () => {
  test('issue created in tab A appears in tab B', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Both tabs log in as the same user
    await loginAs(pageA, 'e2e@test.local');
    await loginAs(pageB, 'e2e@test.local');

    // Wait for sync bootstrap to complete in both tabs
    await pageA.waitForSelector('[data-testid="issue-list-view"]');
    await pageB.waitForSelector('[data-testid="issue-list-view"]');

    const title = `Sync test ${Date.now()}`;

    // Create issue in tab A. Submit via Enter on the title input — the
    // submit button can disappear momentarily when MobX-derived props
    // re-render the modal.
    await pageA.keyboard.press('c');
    const dialogA = pageA.getByRole('dialog', { name: /create issue/i });
    await expect(dialogA).toBeVisible();
    const titleA = dialogA.getByPlaceholder(/issue title/i);
    await titleA.fill(title);
    await titleA.press('Enter');

    // Verify in tab A
    await expect(pageA.getByText(title)).toBeVisible({ timeout: 5000 });

    // Verify in tab B (WebSocket push or delta sync catchup). Allow a little
    // more headroom — the delta sync poll interval can cause a delay if the
    // direct WS broadcast misses the second context.
    await expect(pageB.getByText(title)).toBeVisible({ timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });

  test('status change in tab A is reflected in tab B', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginAs(pageA, 'e2e@test.local');
    await loginAs(pageB, 'e2e@test.local');

    await pageA.waitForSelector('[data-testid="issue-list-view"]');
    await pageB.waitForSelector('[data-testid="issue-list-view"]');

    // Pre-create a fresh issue in tab A so we don't mutate a seeded ENG-N
    // that sibling specs (issue-crud, issue-detail) look up by title.
    const issueTitle = `Sync status ${Date.now()}`;
    await pageA.keyboard.press('c');
    const dialogA = pageA.getByRole('dialog', { name: /create issue/i });
    await expect(dialogA).toBeVisible();
    await dialogA.getByPlaceholder(/issue title/i).fill(issueTitle);
    await dialogA.getByPlaceholder(/issue title/i).press('Enter');
    await expect(pageA.getByText(issueTitle)).toBeVisible({ timeout: 10_000 });
    const rowA = pageA.locator('[data-testid="issue-row"]').filter({ hasText: issueTitle }).first();
    await expect(rowA.getByText(/^ENG-\d+$/)).toBeVisible({ timeout: 10_000 });
    await rowA.locator('input[type="checkbox"]').click({ force: true });
    await expect(rowA).toHaveAttribute('data-selected', 'true', { timeout: 5000 });
    await pageA.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Open status popover and pick "Done"
    await pageA.keyboard.press('s');
    const statusPopover = pageA.getByTestId('status-select-popover');
    await expect(statusPopover).toBeVisible();
    await statusPopover.getByText('Done', { exact: true }).click();
    await expect(statusPopover).not.toBeVisible();

    // In tab B, the same issue should land under the Done group-section.
    const doneGroupB = pageB
      .locator('[data-testid="group-section"]')
      .filter({ has: pageB.getByTestId('group-header').filter({ hasText: 'Done' }) })
      .filter({ hasText: issueTitle });
    await expect(doneGroupB).toBeVisible({ timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });

  test('archiving an issue in tab A removes it from tab B list', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginAs(pageA, 'e2e@test.local');
    await loginAs(pageB, 'e2e@test.local');

    await pageA.waitForSelector('[data-testid="issue-list-view"]');
    await pageB.waitForSelector('[data-testid="issue-list-view"]');

    // Pre-create a fresh issue in tab A so we don't archive a seeded ENG-N
    // that sibling specs depend on.
    const title = `Sync archive ${Date.now()}`;
    await pageA.keyboard.press('c');
    const dialogA = pageA.getByRole('dialog', { name: /create issue/i });
    await expect(dialogA).toBeVisible();
    await dialogA.getByPlaceholder(/issue title/i).fill(title);
    await dialogA.getByPlaceholder(/issue title/i).press('Enter');
    await expect(pageA.getByText(title)).toBeVisible({ timeout: 10_000 });

    // Wait for tab B to receive the create + for the temp '…' identifier to
    // reconcile in tab A so checkbox-driven selection sticks.
    await expect(pageB.getByText(title)).toBeVisible({ timeout: 30_000 });
    const rowA = pageA.locator('[data-testid="issue-row"]').filter({ hasText: title }).first();
    await expect(rowA.getByText(/^ENG-\d+$/)).toBeVisible({ timeout: 10_000 });

    // Select the fresh row and archive.
    await rowA.locator('input[type="checkbox"]').click({ force: true });
    await expect(rowA).toHaveAttribute('data-selected', 'true', { timeout: 5000 });
    await pageA.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pageA.keyboard.press('Backspace');

    // Title disappears from tab B.
    await expect(pageB.getByText(title)).toHaveCount(0, { timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });

  test('issue created in tab A and then archived in tab A no longer appears in tab B', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginAs(pageA, 'e2e@test.local');
    await loginAs(pageB, 'e2e@test.local');

    await pageA.waitForSelector('[data-testid="issue-list-view"]');
    await pageB.waitForSelector('[data-testid="issue-list-view"]');

    const title = `Sync archive-after-create ${Date.now()}`;

    // Create in tab A
    await pageA.keyboard.press('c');
    const dialogA = pageA.getByRole('dialog', { name: /create issue/i });
    await expect(dialogA).toBeVisible();
    const titleA = dialogA.getByPlaceholder(/issue title/i);
    await titleA.fill(title);
    await titleA.press('Enter');

    // Wait for it to land in tab A and propagate to tab B
    await expect(pageA.getByText(title)).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByText(title)).toBeVisible({ timeout: 30000 });

    // In tab A, select the new row via its hidden checkbox after the
    // optimistic temp identifier ('…' suffix) reconciles to a real ENG-N.
    // (Clicking the row container falls onto the title button and opens the
    // detail panel; pressing J many times is unreliable when the list has
    // accumulated test data.)
    const rowA = pageA.locator('[data-testid="issue-row"]').filter({ hasText: title }).first();
    await expect(rowA.getByText(/^ENG-\d+$/)).toBeVisible({ timeout: 10000 });
    await rowA.locator('input[type="checkbox"]').click({ force: true });
    await expect(rowA).toHaveAttribute('data-selected', 'true', { timeout: 5000 });
    // Blur the checkbox so Backspace isn't gated by useHotkeys' INPUT check.
    await pageA.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pageA.keyboard.press('Backspace');

    // Title disappears from tab B
    await expect(pageB.getByText(title)).toHaveCount(0, { timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });
});
