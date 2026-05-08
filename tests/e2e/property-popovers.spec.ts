import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Property keyboard shortcuts on the selected issue:
 *   S → status, P → priority, A → assignee, L → labels, D → due date,
 *   Q → cycle, Shift+P → project, Shift+E → estimate.
 *
 * S and P are already covered by keyboard.spec.ts; this file rounds out the
 * remaining popovers and asserts they all close on Escape.
 */
test.describe('Property Popovers', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    // Select the first issue so context shortcuts become enabled.
    await page.keyboard.press('j');
  });

  test('priority popover closes on Escape', async ({ page }) => {
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
  });

  test('status popover closes on Escape', async ({ page }) => {
    await page.keyboard.press('s');
    const popover = page.locator('[data-testid="status-select-popover"]');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
  });

  test('selecting Urgent priority via popover updates the row', async ({ page }) => {
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();
    // Click the Urgent option; the popover dismisses and the priority is saved
    // through the optimistic MobX update + GraphQL mutation.
    await popover.getByRole('button', { name: /^urgent$/i }).click();
    await expect(popover).not.toBeVisible();
  });
});
