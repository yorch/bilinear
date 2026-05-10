import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Webhooks settings page (admin-only).
 *
 * The seeded `e2e@test.local` user is an org admin (see prisma/seed.ts), so
 * the create / list / disable / delete CRUD flow can be exercised end-to-end
 * here. We deliberately stop short of triggering an actual outbound HTTP
 * delivery — verifying the HMAC-signed POST requires a local receiver and
 * is timing-sensitive due to the 30s retry sweep, so signature behaviour is
 * covered by unit tests in `webhook.service.test.ts`.
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

  test('create webhook persists and appears in the list', async ({ page }) => {
    const ts = Date.now();
    const name = `E2E Webhook ${ts}`;
    const url = `https://example.com/hook-${ts}`;

    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await page.getByPlaceholder('Production CI').fill(name);
    await page.getByPlaceholder('https://example.com/hook').fill(url);

    // Subscribe to at least one event — server rejects empty event arrays
    // with WebhookNoEventsError.
    await page.getByRole('checkbox', { name: 'issue.created' }).check();

    await page.getByRole('button', { name: /^create webhook$/i }).click();

    // Form closes (the toggle button reverts to "+ Add webhook").
    await expect(page.getByRole('button', { name: /\+\s*add webhook/i })).toBeVisible();
    await expect(page.getByPlaceholder('Production CI')).not.toBeVisible();

    // The new webhook shows up in the list along with its URL.
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText(url)).toBeVisible();
  });

  test('created webhook can be disabled', async ({ page }) => {
    const ts = Date.now();
    const name = `E2E Disable ${ts}`;
    const url = `https://example.com/disable-${ts}`;

    // Create.
    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await page.getByPlaceholder('Production CI').fill(name);
    await page.getByPlaceholder('https://example.com/hook').fill(url);
    await page.getByRole('checkbox', { name: 'issue.created' }).check();
    await page.getByRole('button', { name: /^create webhook$/i }).click();

    // Scope to the closest webhook card (the rounded outer div) so we don't
    // pick up status badges or action buttons from sibling rows.
    const card = page
      .getByText(name, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded") and contains(@class,"p-4")][1]');
    await expect(card).toBeVisible();

    // Initially enabled. Use `Enabled` (capitalised, the actual badge text)
    // to avoid matching the "Continue with email" Enable... fragments.
    await expect(card.getByText('Enabled', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: /^disable$/i }).click();

    // The disable button flips to "Enable" and the status badge swaps.
    await expect(card.getByRole('button', { name: /^enable$/i })).toBeVisible();
    await expect(card.getByText('Disabled', { exact: true })).toBeVisible();
  });

  test('created webhook can be deleted', async ({ page }) => {
    const ts = Date.now();
    const name = `E2E Delete ${ts}`;
    const url = `https://example.com/delete-${ts}`;

    // Create.
    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await page.getByPlaceholder('Production CI').fill(name);
    await page.getByPlaceholder('https://example.com/hook').fill(url);
    await page.getByRole('checkbox', { name: 'issue.created' }).check();
    await page.getByRole('button', { name: /^create webhook$/i }).click();

    await expect(page.getByText(name)).toBeVisible();

    const card = page
      .getByText(name, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded") and contains(@class,"p-4")][1]');

    // Delete uses window.confirm() — auto-accept it. Await accept() so the
    // dialog is fully dismissed before the click handler resolves; otherwise
    // the close races the navigation/state update under load.
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      await dialog.accept();
    });
    await card.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByText(name)).not.toBeVisible();
  });

  test('SSRF-protected URL is rejected at create time', async ({ page }) => {
    const ts = Date.now();
    const name = `E2E SSRF ${ts}`;

    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await page.getByPlaceholder('Production CI').fill(name);
    await page.getByPlaceholder('https://example.com/hook').fill('http://127.0.0.1:1234/hook');
    await page.getByRole('checkbox', { name: 'issue.created' }).check();
    await page.getByRole('button', { name: /^create webhook$/i }).click();

    // Server message comes from WebhookPrivateUrlError —
    // "Webhook URL cannot point to a private/internal address".
    await expect(page.getByText(/private\/internal address/i)).toBeVisible();

    // Webhook should NOT appear in the list.
    await expect(page.getByText(name)).not.toBeVisible();
  });

  test('invalid URL shows a validation error', async ({ page }) => {
    const ts = Date.now();
    const name = `E2E Invalid ${ts}`;

    await page.getByRole('button', { name: /\+\s*add webhook/i }).click();
    await page.getByPlaceholder('Production CI').fill(name);
    await page.getByPlaceholder('https://example.com/hook').fill('not-a-url');
    await page.getByRole('checkbox', { name: 'issue.created' }).check();
    await page.getByRole('button', { name: /^create webhook$/i }).click();

    // WebhookInvalidUrlError → "Webhook URL must be a valid http(s) URL".
    await expect(page.getByText(/valid http\(s\) url/i)).toBeVisible();

    await expect(page.getByText(name)).not.toBeVisible();
  });
});
