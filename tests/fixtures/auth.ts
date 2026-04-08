import type { Page } from '@playwright/test';

/**
 * Log in as the test user via the magic-link email flow.
 *
 * Requires the dev server to be started with:
 *   NODE_ENV=test TEST_AUTH_CODE=000000
 *
 * When NODE_ENV=test and TEST_AUTH_CODE is set, AuthService.verifyMagicLink
 * accepts that code for any email without checking the database, making E2E
 * auth deterministic. The playwright.config.ts webServer sets these env vars
 * automatically.
 *
 * NOTE: VerifyCodeForm auto-submits when a 6-digit code is entered via
 * onChange — no button click is needed or safe here (clicking the button
 * after auto-submit navigates the page and throws a detach error).
 */
export async function loginAs(page: Page, email: string, code?: string) {
  const verifyCode = code ?? process.env.TEST_AUTH_CODE ?? '000000';

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByTestId('email-submit').click();

  // Wait for the verify page
  await page.waitForURL('**/verify**');
  // Filling a 6-digit code triggers handleCodeChange which auto-submits the form.
  await page.getByLabel(/code/i).fill(verifyCode);

  // Should land on the team issues page (past all workspace redirects)
  await page.waitForURL('**/team/**', { timeout: 30_000 });
}

/**
 * Ensure the test user is logged out.
 */
export async function logout(page: Page) {
  await page.goto('/api/auth/logout');
}
