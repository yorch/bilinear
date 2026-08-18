import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Team creation from the sidebar.
 *
 * The sidebar exposes a "+ New team" affordance that opens a modal. The form
 * auto-derives a key (e.g. "Engineering" → "ENG") and validates uniqueness
 * server-side; we exercise the open/cancel/derive flow without committing
 * a creation that would mutate seed state across runs.
 */
test.describe('Team Creation', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('clicking "New team" in the sidebar opens the create-team dialog', async ({ page }) => {
    await page
      .locator('aside')
      .getByRole('button', { name: /^new team$/i })
      .click();
    await expect(page.getByRole('dialog', { name: /create team/i })).toBeVisible();
    await expect(page.getByLabel(/^name$/i)).toBeVisible();
  });

  test('typing a name auto-derives the team key', async ({ page }) => {
    await page
      .locator('aside')
      .getByRole('button', { name: /^new team$/i })
      .click();
    await page.getByLabel(/^name$/i).fill('Quality Engineering');
    // First-letter-of-each-word, uppercase: "Quality Engineering" → "QE"
    await expect(page.getByLabel(/identifier/i)).toHaveValue('QE');
  });

  test('escape closes the create-team dialog', async ({ page }) => {
    await page
      .locator('aside')
      .getByRole('button', { name: /^new team$/i })
      .click();
    const dialog = page.getByRole('dialog', { name: /create team/i });
    await expect(dialog).toBeVisible();
    // Press Escape from the dialog so its onKeyDown handler receives the
    // event no matter which descendant currently has focus.
    await dialog.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
