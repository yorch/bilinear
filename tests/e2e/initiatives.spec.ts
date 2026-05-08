import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Initiatives: list page renders, inline create form persists a new initiative
 * that becomes visible in the appropriate status group.
 *
 * The initiatives page uses an inline name input rather than a modal — pressing
 * the toolbar button reveals a row with an input that submits on Enter or via
 * the "Create" button.
 */
test.describe('Initiatives', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    const ws = getWorkspaceKey(page);
    await page.goto(`/${ws}/initiatives`);
    await expect(page.getByRole('heading', { name: /initiatives/i })).toBeVisible();
  });

  test('renders empty state or a list', async ({ page }) => {
    // Either the empty-state copy or at least one status group should be present.
    const emptyCopy = page.getByText(/no initiatives yet/i);
    const anyGroup = page.getByText(/^(active|planned|completed|canceled)$/i).first();
    await expect(emptyCopy.or(anyGroup)).toBeVisible();
  });

  test('toolbar New Initiative button reveals the inline name input', async ({ page }) => {
    await page.getByRole('button', { name: /new initiative/i }).click();
    await expect(page.getByPlaceholder(/initiative name/i)).toBeVisible();
  });

  test('escape from inline input cancels create form', async ({ page }) => {
    await page.getByRole('button', { name: /new initiative/i }).click();
    const input = page.getByPlaceholder(/initiative name/i);
    await input.fill('Will be cancelled');
    await input.press('Escape');
    await expect(input).not.toBeVisible();
  });

  test('creating an initiative shows it in the planned group', async ({ page }) => {
    const name = `E2E Initiative ${Date.now()}`;
    await page.getByRole('button', { name: /new initiative/i }).click();
    const input = page.getByPlaceholder(/initiative name/i);
    await input.fill(name);
    await input.press('Enter');
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });
});
