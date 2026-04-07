import { expect, test } from '@playwright/test';

/**
 * Auth critical path: email magic link login → verify code → see workspace.
 *
 * NOTE: These tests require a running dev server with a seeded test database.
 * The verification code bypass is controlled by the TEST_AUTH_CODE env var.
 */
test.describe('Authentication', () => {
  test('shows login page when unauthenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page renders email input and submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
  });

  test('submitting email navigates to verify page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('e2e@test.local');
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page).toHaveURL(/\/verify/);
  });

  test('verify page renders code input', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByLabel(/code/i)).toBeVisible();
  });

  test('invalid code shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('e2e@test.local');
    await page.getByRole('button', { name: /send/i }).click();
    await page.waitForURL(/\/verify/);
    await page.getByLabel(/code/i).fill('000000');
    await page.getByRole('button', { name: /verify|continue/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
