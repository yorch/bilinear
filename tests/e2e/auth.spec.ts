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
    await expect(page.getByTestId('email-submit')).toBeVisible();
  });

  test('submitting email navigates to verify page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('e2e@test.local');
    await page.getByTestId('email-submit').click();
    await expect(page).toHaveURL(/\/verify/);
  });

  test('verify page renders code input', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByLabel(/code/i)).toBeVisible();
  });

  test('invalid code shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('e2e@test.local');
    await page.getByTestId('email-submit').click();
    await page.waitForURL(/\/verify/);
    // Use a code that is NOT the TEST_AUTH_CODE bypass ('000000') so the
    // server actually validates it and returns an error.
    await page.getByLabel(/code/i).fill('999999');
    // 6-digit input auto-submits via onChange; the server rejects the code
    // and the form renders an error alert.
    //
    // Scoped to the form: Next renders its own route announcer as
    // `<div role="alert" id="__next-route-announcer__">`, and it holds the
    // title of the page just navigated to ("Verify — Bilinear"). An unscoped
    // `getByRole('alert')` therefore resolves to two elements and fails on
    // strict mode — but only when the announcer still has its text by the
    // time the server's rejection lands, which is why this passed far more
    // often than it should have.
    await expect(page.locator('form').getByRole('alert')).toBeVisible();
  });
});
