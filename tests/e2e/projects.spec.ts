import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Projects: list page renders, "New Project" opens the create modal,
 * submitting the form persists a new project that becomes visible in the list.
 */
test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    const ws = getWorkspaceKey(page);
    await page.goto(`/${ws}/projects`);
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
  });

  // The header and (on an empty list) the empty-state CTA both read
  // "New project" and both call uiStore.openCreateProjectModal. The header
  // button is always present and first in DOM order, so target it.
  const toolbarBtn = (page: import('@playwright/test').Page) =>
    page.getByRole('button', { exact: true, name: 'New project' }).first();

  test('New Project button opens the create-project dialog', async ({ page }) => {
    await toolbarBtn(page).click();
    await expect(page.getByRole('dialog', { name: /new project/i })).toBeVisible();
    await expect(page.getByLabel(/^name$/i)).toBeVisible();
  });

  test('escape closes the create-project dialog', async ({ page }) => {
    await toolbarBtn(page).click();
    const dialog = page.getByRole('dialog', { name: /new project/i });
    await expect(dialog).toBeVisible();
    // Press Escape from the dialog so the dialog's onKeyDown receives the
    // event regardless of which descendant currently has focus.
    await dialog.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('submit-disabled state when name is empty', async ({ page }) => {
    await toolbarBtn(page).click();
    const dialog = page.getByRole('dialog', { name: /new project/i });
    const submit = dialog.getByRole('button', { exact: true, name: 'Create project' });
    // The form's submit button is disabled until a name is entered.
    await expect(submit).toBeDisabled();
  });

  test('creating a project shows it in the active group', async ({ page }) => {
    const projectName = `E2E Project ${Date.now()}`;
    await toolbarBtn(page).click();
    await page.getByLabel(/^name$/i).fill(projectName);
    await page
      .getByRole('dialog', { name: /new project/i })
      .getByRole('button', { exact: true, name: 'Create project' })
      .click();
    await expect(page.getByRole('dialog', { name: /new project/i })).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });
  });
});
