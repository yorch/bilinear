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

    // Select first issue in tab A and read its title from the active row's
    // title button.
    await pageA.keyboard.press('j');
    const activeRowA = pageA.locator('[data-testid="issue-row"][data-selected="true"]').first();
    await expect(activeRowA).toBeVisible();
    const issueTitle = (await activeRowA.locator('button.flex-1').textContent())?.trim();
    expect(issueTitle).toBeTruthy();

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
      .filter({ hasText: issueTitle as string });
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

    // Select first issue and grab its title
    await pageA.keyboard.press('j');
    const activeRowA = pageA.locator('[data-testid="issue-row"][data-selected="true"]').first();
    await expect(activeRowA).toBeVisible();
    const issueTitle = (await activeRowA.locator('button.flex-1').textContent())?.trim();
    expect(issueTitle).toBeTruthy();

    // Confirm tab B currently shows it
    await expect(pageB.getByText(issueTitle as string).first()).toBeVisible();

    // Archive via Backspace
    await pageA.keyboard.press('Backspace');

    // Title should disappear from tab B
    await expect(pageB.getByText(issueTitle as string)).toHaveCount(0, { timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });

  test('issue created in tab A and then deleted in tab A no longer appears in tab B', async ({
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

    const title = `Sync delete ${Date.now()}`;

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

    // In tab A, navigate selection (J) until the active row is the new issue,
    // then archive via Backspace. (Clicking the row's title button opens the
    // detail panel rather than selecting, so we drive selection via J.)
    const rowA = pageA.locator('[data-testid="issue-row"]').filter({ hasText: title }).first();
    // Press J up to N times to land on our row.
    for (let i = 0; i < 20; i++) {
      await pageA.keyboard.press('j');
      const isSelected = await rowA.getAttribute('data-selected');
      if (isSelected === 'true') {
        break;
      }
    }
    await expect(rowA).toHaveAttribute('data-selected', 'true');
    await pageA.keyboard.press('Backspace');

    // Title disappears from tab B
    await expect(pageB.getByText(title)).toHaveCount(0, { timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });
});
