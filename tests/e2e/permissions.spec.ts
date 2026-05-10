import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { gqlInPage } from '../fixtures/graphql';
import { getWorkspaceKey } from '../fixtures/workspace';

const WEBHOOK_INPUT = {
  events: ['issue.created'],
  url: 'https://example.com/hook',
};

/**
 * Role-gating for admin-only surfaces.
 *
 * The seed creates `e2e-member@test.local` with org role=member (no admin
 * privileges). These tests verify the server enforces FORBIDDEN on the
 * admin-gated webhook surface and that the UI degrades gracefully when the
 * GraphQL queries come back rejected.
 *
 * Apollo returns `errors: [{ message, extensions: { code } }]`. Don't assume
 * FORBIDDEN is at index 0 — middleware ordering or future resolver behavior
 * could push it later. Use `errors.some(...)` instead.
 */
test.describe('Permissions — admin-only routes', () => {
  test('non-admin webhookCreate returns FORBIDDEN', async ({ page }) => {
    await loginAs(page, 'e2e-member@test.local');

    const result = await gqlInPage(
      page,
      `mutation Create($input: WebhookCreateInput!) { webhookCreate(input: $input) { success } }`,
      { input: { ...WEBHOOK_INPUT, name: 'Forbidden create attempt' } },
    );

    expect(result.errors?.length ?? 0).toBeGreaterThan(0);
    expect(result.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
  });

  test('non-admin webhooks query returns FORBIDDEN', async ({ page }) => {
    await loginAs(page, 'e2e-member@test.local');

    const result = await gqlInPage(page, `query { webhooks { id name } }`);

    expect(result.errors?.length ?? 0).toBeGreaterThan(0);
    expect(result.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
  });

  test('admin webhookCreate succeeds (control)', async ({ page }) => {
    await loginAs(page, 'e2e@test.local');

    const result = await gqlInPage<{
      webhookCreate: { success: boolean; webhook?: { id: string } };
    }>(
      page,
      `mutation Create($input: WebhookCreateInput!) {
        webhookCreate(input: $input) { success webhook { id } }
      }`,
      { input: { ...WEBHOOK_INPUT, name: `Permission control ${Date.now()}` } },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.webhookCreate?.success).toBe(true);

    // Cleanup so the seed list doesn't grow per test run.
    const id = result.data?.webhookCreate?.webhook?.id;
    if (id) {
      await gqlInPage(page, `mutation($id: ID!) { webhookDelete(id: $id) { success } }`, { id });
    }
  });

  test('non-admin loading the webhooks settings page does not crash', async ({ page }) => {
    await loginAs(page, 'e2e-member@test.local');
    const ws = getWorkspaceKey(page);
    await page.goto(`/${ws}/settings/webhooks`);

    // The page renders its own shell even when the query is rejected — it
    // toasts the error and shows an empty list. We want the workspace
    // error boundary to NOT take over (i.e. there is no "Something went
    // wrong" page-level fallback).
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('heading', { name: /webhook/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
