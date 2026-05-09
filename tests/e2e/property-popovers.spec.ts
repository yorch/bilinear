import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Property keyboard shortcuts on the selected issue:
 *   S → status, P → priority, A → assignee, L → labels, D → due date,
 *   Q → cycle, Shift+P → project, Shift+E → estimate.
 *
 * The popovers dismiss on outside click rather than on Escape (the
 * components only register a mousedown handler), so we close them by
 * clicking outside the popover region.
 */
test.describe('Property Popovers', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    // Select the first issue so context shortcuts become enabled.
    await page.keyboard.press('j');
  });

  test('priority popover closes when clicking outside', async ({ page }) => {
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();
    // Click in the sidebar (outside the popover) to dismiss it.
    await page.locator('aside').click();
    await expect(popover).not.toBeVisible();
  });

  test('status popover closes when clicking outside', async ({ page }) => {
    await page.keyboard.press('s');
    const popover = page.locator('[data-testid="status-select-popover"]');
    await expect(popover).toBeVisible();
    await page.locator('aside').click();
    await expect(popover).not.toBeVisible();
  });

  test('selecting a priority option dismisses the popover', async ({ page }) => {
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();
    // Each option button renders the priority icon glyph followed by the
    // label, so the accessible name is e.g. "!!! Urgent" — match the label
    // substring rather than anchoring on the whole name.
    await popover.getByRole('button', { name: /urgent/i }).click();
    await expect(popover).not.toBeVisible();
  });
});
