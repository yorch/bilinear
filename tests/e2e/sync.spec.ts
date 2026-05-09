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

    // Create issue in tab A. Scope the modal interactions so /create/i doesn't
    // collide with sidebar buttons like "Create a team".
    await pageA.keyboard.press('c');
    const dialogA = pageA.getByRole('dialog', { name: /create issue/i });
    await expect(dialogA).toBeVisible();
    await dialogA.getByPlaceholder(/issue title/i).fill(title);
    await dialogA.getByRole('button', { exact: true, name: 'Create issue' }).click();

    // Verify in tab A
    await expect(pageA.getByText(title)).toBeVisible({ timeout: 5000 });

    // Verify in tab B (WebSocket push or delta sync catchup). Allow a little
    // more headroom — the delta sync poll interval can cause a delay if the
    // direct WS broadcast misses the second context.
    await expect(pageB.getByText(title)).toBeVisible({ timeout: 30000 });

    await contextA.close();
    await contextB.close();
  });
});
