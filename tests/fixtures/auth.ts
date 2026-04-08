import type { Page } from '@playwright/test';

/**
 * Log in as the test user via the magic-link email flow.
 *
 * Requires the dev server to be started with:
 *   NODE_ENV=test TEST_AUTH_CODE=e2e-test-code
 *
 * When NODE_ENV=test and TEST_AUTH_CODE is set, AuthService.verifyMagicLink
 * accepts that code for any email without checking the database, making E2E
 * auth deterministic. The playwright.config.ts webServer sets these env vars
 * automatically.
 */
export async function loginAs(page: Page, email: string, code?: string) {
  const verifyCode = code ?? process.env.TEST_AUTH_CODE ?? '000000';

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByTestId('email-submit').click();

  // Wait for the verify page
  await page.waitForURL('**/verify**');
  await page.getByLabel(/code/i).fill(verifyCode);
  await page.getByRole('button', { name: /verify|continue/i }).click();

  // Should land on the workspace (any URL that isn't an auth page)
  await page.waitForURL(
    url =>
      !url.toString().includes('/login') && !url.toString().includes('/verify'),
  );
}

/**
 * Ensure the test user is logged out.
 */
export async function logout(page: Page) {
  await page.goto('/api/auth/logout');
}
