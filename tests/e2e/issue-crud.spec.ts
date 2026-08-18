import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Issue CRUD critical path:
 *   create issue → verify in list → edit fields → archive
 */
test.describe('Issue CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('C shortcut opens create-issue modal', async ({ page }) => {
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByPlaceholder(/issue title/i)).toBeVisible();
  });

  test('create issue and verify it appears in list', async ({ page }) => {
    const title = `Test issue ${Date.now()}`;

    // Open modal and create — scope the lookups to the dialog so /create/i
    // can't pick up an unrelated sidebar button, and submit by exact name
    // to avoid colliding with the empty-state CTA on neighbouring routes.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/issue title/i).fill(title);
    await dialog.getByRole('button', { exact: true, name: 'Create issue' }).click();

    // Issue should appear in the list (use .first() to tolerate the brief
    // window where the optimistic temp row coexists with the WS-broadcast
    // confirmation before the store dedup runs).
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking issue identifier opens detail panel', async ({ page }) => {
    // Click the title button on a seeded row directly — clicking the row
    // container at its visual centre can land on a sibling control
    // (priority, label, due-date) that doesn't trigger onOpen.
    await page
      .locator('[data-testid="issue-row"]', { hasText: 'Set up CI/CD pipeline' })
      .getByRole('button', { exact: true, name: 'Set up CI/CD pipeline' })
      .click();
    await expect(page.locator('[data-testid="issue-detail-panel"]')).toBeVisible();
  });

  test('escape closes detail panel', async ({ page }) => {
    await page
      .locator('[data-testid="issue-row"]', { hasText: 'Set up CI/CD pipeline' })
      .getByRole('button', { exact: true, name: 'Set up CI/CD pipeline' })
      .click();
    await expect(page.locator('[data-testid="issue-detail-panel"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="issue-detail-panel"]')).not.toBeVisible();
  });
});
