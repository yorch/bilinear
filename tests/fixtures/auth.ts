import type { Page } from '@playwright/test';

/**
 * Log in as the test user via the magic-link email flow.
 *
 * In test mode the server should be configured to emit the verification code
 * to stdout (SMTP_DISABLE=1 or similar), and the fixture reads it.
 * For now we use a well-known test account + bypass code set via TEST_AUTH_CODE
 * environment variable (set in the test seed script).
 */
export async function loginAs(page: Page, email: string, code?: string) {
  const verifyCode = code ?? process.env.TEST_AUTH_CODE ?? '123456';

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /send/i }).click();

  // Wait for the verify page
  await page.waitForURL('**/verify**');
  await page.getByLabel(/code/i).fill(verifyCode);
  await page.getByRole('button', { name: /verify|continue/i }).click();

  // Should land on the workspace
  await page.waitForURL('**/(my-issues|team|inbox)**');
}

/**
 * Ensure the test user is logged out.
 */
export async function logout(page: Page) {
  await page.goto('/api/auth/logout');
}
