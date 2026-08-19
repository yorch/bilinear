import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, loginAs } from '../fixtures/auth';

/**
 * Auth session lifecycle:
 *   - clearing the access_token + refresh_token cookies effectively logs the
 *     user out
 *   - subsequent navigation to a workspace route redirects to /login
 *
 * The application doesn't expose a REST logout route — the production logout
 * is the `logout` GraphQL mutation — so we exercise the cookie-cleared
 * behaviour via the browser context APIs directly.
 */
test.describe('Auth Session Lifecycle', () => {
  test('clearing auth cookies redirects subsequent requests to /login', async ({
    context,
    page,
  }) => {
    await loginAs(page, ADMIN_EMAIL);
    await context.clearCookies();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
