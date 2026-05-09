import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Webhooks settings page (admin-only).
 *
 * The seeded `e2e@test.local` user is a member rather than an org admin, so
 * the loaded webhook list will be empty for this user. We assert the page
 * shell renders and the create form opens — the admin-only API gate is
 * exercised in unit tests.
 */
test.describe('Webhooks Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    const ws = getWorkspaceKey(page);
    await page.goto(`/${ws}/settings/webhooks`);
    await expect(page.getByRole('heading', { name: /^webhooks$/i })).toBeVisible();
  });

  test('Add Webhook button reveals the inline create form', async ({ page }) => {
    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await expect(page.getByPlaceholder('Production CI')).toBeVisible();
    await expect(page.getByPlaceholder('https://example.com/hook')).toBeVisible();
  });

  test('clicking Cancel hides the create form', async ({ page }) => {
    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await expect(page.getByPlaceholder('Production CI')).toBeVisible();
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByPlaceholder('Production CI')).not.toBeVisible();
  });
});
