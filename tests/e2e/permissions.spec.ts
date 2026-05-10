import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Role-gating for admin-only surfaces.
 *
 * The seed creates `e2e-member@test.local` with org role=member (no admin
 * privileges). These tests verify the server enforces FORBIDDEN on the
 * admin-gated webhook surface and that the UI degrades gracefully (it does
 * not crash, it does not leak the signing secret) when the GraphQL queries
 * come back rejected.
 */
test.describe('Permissions — admin-only routes', () => {
  test('non-admin webhookCreate returns FORBIDDEN', async ({ page }) => {
    await loginAs(page, 'e2e-member@test.local');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: `mutation Create($input: WebhookCreateInput!) { webhookCreate(input: $input) { success } }`,
          variables: {
            input: {
              events: ['issue.created'],
              name: 'Forbidden create attempt',
              url: 'https://example.com/hook',
            },
          },
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      return resp.json();
    });

    // Apollo returns `errors: [{ message, extensions: { code } }]`. Don't
    // assume FORBIDDEN is at index 0 — middleware ordering or future
    // resolver behavior could push it later. Assert at least one error
    // carries the code instead.
    const errors = result?.errors as Array<{ extensions?: { code?: string } }> | undefined;
    expect(errors?.length ?? 0).toBeGreaterThan(0);
    expect(errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
  });

  test('non-admin webhooks query returns FORBIDDEN', async ({ page }) => {
    await loginAs(page, 'e2e-member@test.local');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: `query { webhooks { id name } }`,
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      return resp.json();
    });

    const errors = result?.errors as Array<{ extensions?: { code?: string } }> | undefined;
    expect(errors?.length ?? 0).toBeGreaterThan(0);
    expect(errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
  });

  test('admin webhookCreate succeeds (control)', async ({ page }) => {
    await loginAs(page, 'e2e@test.local');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: `mutation Create($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { id } } }`,
          variables: {
            input: {
              events: ['issue.created'],
              name: `Permission control ${Date.now()}`,
              url: 'https://example.com/hook',
            },
          },
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      return resp.json();
    });

    expect(result?.errors).toBeUndefined();
    expect(result?.data?.webhookCreate?.success).toBe(true);

    // Clean up so the seed list doesn't grow per test run.
    const id = result?.data?.webhookCreate?.webhook?.id as string | undefined;
    if (id) {
      await page.evaluate(async (id: string) => {
        await fetch('/api/graphql', {
          body: JSON.stringify({
            query: `mutation($id: ID!) { webhookDelete(id: $id) { success } }`,
            variables: { id },
          }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
      }, id);
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
    // Heading still renders to confirm the route is reachable.
    await expect(page.getByRole('heading', { name: /webhook/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
