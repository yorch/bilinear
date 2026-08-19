import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Notifications inbox: page renders, empty-state or list visible.
 *
 * The "Mark all read" button only appears when there are unread items, so
 * we don't unconditionally assert it.
 */
test.describe('Inbox', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    const ws = getWorkspaceKey(page);
    await page.goto(`/${ws}/inbox`);
  });

  test('inbox heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^inbox$/i })).toBeVisible();
  });

  test('shows empty-state or notifications list', async ({ page }) => {
    const empty = page.getByText(/all caught up/i);
    const unreadHeader = page.getByText(/^unread \(/i);
    const readHeader = page.getByText(/^read$|^all notifications$/i);
    await expect(empty.or(unreadHeader).or(readHeader)).toBeVisible({ timeout: 15_000 });
  });
});
