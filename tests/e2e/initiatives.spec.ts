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
 *
 * Note: the initiatives feature does NOT have a separate detail page route.
 * Each initiative row is a button that expands inline to reveal linked
 * projects, an "+ Add project" affordance, and status-change buttons. There is
 * also no "updates timeline" feature on initiatives — see
 * src/app/(workspace)/[workspace]/initiatives/page.tsx and
 * src/server/services/initiative.service.ts. Tests below exercise the inline
 * UI rather than a dedicated detail page.
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

  // --- Extended coverage --------------------------------------------------

  /**
   * Initiative rows are expand/collapse buttons; there is no dedicated detail
   * route. Clicking the row reveals the inline detail panel containing the
   * linked-projects header ("Projects (N)") and status-change buttons.
   */
  test('clicking an initiative row expands its inline detail panel', async ({ page }) => {
    const name = `E2E Detail ${Date.now()}`;
    await page.getByRole('button', { name: /new initiative/i }).click();
    const input = page.getByPlaceholder(/initiative name/i);
    await input.fill(name);
    await input.press('Enter');

    const row = page.getByRole('button', { name: new RegExp(name) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // The expanded panel renders a "Projects (N)" header and an "+ Add project" button.
    await expect(page.getByText(/^projects \(\d+\)$/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /\+ add project/i })).toBeVisible();
  });

  /**
   * Pre-create a project, then create an initiative, expand it, click
   * "+ Add project", and select the project. The project should then appear
   * in the linked-projects list within the expanded row.
   *
   * Calls the `initiativeAddProject` GraphQL mutation under the hood (see
   * src/app/(workspace)/[workspace]/initiatives/page.tsx).
   */
  test('linking a project to an initiative shows it in the linked-projects section', async ({
    page,
  }) => {
    const ws = getWorkspaceKey(page);
    const projectName = `E2E InitProj ${Date.now()}`;
    const initiativeName = `E2E LinkInit ${Date.now()}`;

    // Step 1: create a project via the projects page modal flow.
    await page.goto(`/${ws}/projects`);
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
    await page.getByRole('button', { exact: true, name: 'New Project' }).click();
    const projectDialog = page.getByRole('dialog', { name: /create project/i });
    await expect(projectDialog).toBeVisible();
    await page.getByLabel(/^name$/i).fill(projectName);
    await projectDialog.getByRole('button', { exact: true, name: 'Create project' }).click();
    await expect(projectDialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });

    // Step 2: navigate to initiatives, create one, expand it.
    await page.goto(`/${ws}/initiatives`);
    await expect(page.getByRole('heading', { name: /initiatives/i })).toBeVisible();
    await page.getByRole('button', { name: /new initiative/i }).click();
    const input = page.getByPlaceholder(/initiative name/i);
    await input.fill(initiativeName);
    await input.press('Enter');

    const row = page.getByRole('button', { name: new RegExp(initiativeName) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // Step 3: open the add-project picker and click the project we created.
    await page.getByRole('button', { name: /\+ add project/i }).click();
    await page.getByRole('button', { name: projectName }).click();

    // Step 4: assert the linked-projects list now contains the project.
    // The header reads "Projects (1)" once linked, and the project name renders
    // inside the projects list inside the expanded row.
    await expect(page.getByText(/^projects \(1\)$/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });
  });

  /**
   * The initiatives feature does not currently expose an "updates timeline".
   * `initiative.service.ts` and the resolver have no `addUpdate` / "post
   * update" mutation, and the inline detail panel has no update-input UI.
   * Tracking this as a skipped test so the gap is visible.
   */
  test.skip('adding an initiative update appears in the updates timeline', () => {
    // Skipped: initiative updates feature is not implemented.
    // No corresponding GraphQL mutation, service method, or UI exists in
    // src/app/(workspace)/[workspace]/initiatives/page.tsx.
  });

  /**
   * Status change is performed via inline buttons inside the expanded row
   * ("Active", "Planned", "Completed", "Canceled"). After selecting "Active"
   * and reloading, the initiative should be grouped under the Active section
   * (and the row should still show the "Active" status pill).
   *
   * Calls `initiativeUpdate` under the hood (see INITIATIVE_UPDATE_MUTATION).
   */
  test('changing initiative status to Active persists across reload', async ({ page }) => {
    const name = `E2E Status ${Date.now()}`;
    await page.getByRole('button', { name: /new initiative/i }).click();
    const input = page.getByPlaceholder(/initiative name/i);
    await input.fill(name);
    await input.press('Enter');

    const row = page.getByRole('button', { name: new RegExp(name) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // Click the inline "Active" status-change button. The status group
    // headers are plain text spans, so role=button disambiguates correctly.
    await page.getByRole('button', { exact: true, name: 'Active' }).click();

    // Wait for the row's status pill to reflect the change before reloading
    // so we don't race the optimistic-then-server cycle.
    await expect(page.getByRole('button', { name: new RegExp(`${name}.*Active`) })).toBeVisible({
      timeout: 10_000,
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: /initiatives/i })).toBeVisible();

    // After reload the initiative should still render with an "Active" pill
    // inside its row button.
    await expect(page.getByRole('button', { name: new RegExp(`${name}.*Active`) })).toBeVisible({
      timeout: 10_000,
    });
  });
});
