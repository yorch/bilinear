import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Projects: list page renders, "New Project" opens the create modal,
 * submitting the form persists a new project that becomes visible in the list.
 */
test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    const ws = getWorkspaceKey(page);
    await page.goto(`/${ws}/projects`);
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
  });

  test('New Project button opens the create-project dialog', async ({ page }) => {
    await page
      .getByRole('button', { name: /new project|create project/i })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: /create project/i })).toBeVisible();
    await expect(page.getByLabel(/^name$/i)).toBeVisible();
  });

  test('escape closes the create-project dialog', async ({ page }) => {
    await page
      .getByRole('button', { name: /new project|create project/i })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: /create project/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /create project/i })).not.toBeVisible();
  });

  test('submit-disabled state when name is empty', async ({ page }) => {
    await page
      .getByRole('button', { name: /new project|create project/i })
      .first()
      .click();
    const submit = page.getByRole('button', { name: /^create project$/i });
    // The form's submit button is disabled until a name is entered.
    await expect(submit).toBeDisabled();
  });

  test('creating a project shows it in the active group', async ({ page }) => {
    const projectName = `E2E Project ${Date.now()}`;
    await page
      .getByRole('button', { name: /new project|create project/i })
      .first()
      .click();
    await page.getByLabel(/^name$/i).fill(projectName);
    await page.getByRole('button', { name: /^create project$/i }).click();
    await expect(page.getByRole('dialog', { name: /create project/i })).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });
  });
});
