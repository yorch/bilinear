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
    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    const title = `Sync test ${Date.now()}`;

    // Create issue in tab A
    await pageA.keyboard.press('c');
    await pageA.getByPlaceholder(/issue title/i).fill(title);
    await pageA.getByRole('button', { name: /create/i }).click();

    // Verify in tab A
    await expect(pageA.getByText(title)).toBeVisible({ timeout: 5000 });

    // Verify in tab B (WebSocket push)
    await expect(pageB.getByText(title)).toBeVisible({ timeout: 10000 });

    await contextA.close();
    await contextB.close();
  });
});
