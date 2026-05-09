import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Property keyboard shortcuts on the selected issue:
 *   S → status, P → priority, A → assignee, L → labels, D → due date,
 *   Q → cycle, Shift+P → project, Shift+E → estimate.
 *
 * `property-popovers.spec.ts` only covered S and P. This spec extends the
 * coverage to the rest of the property shortcuts by asserting that each
 * popover opens with its expected marker (search input, empty-state copy,
 * etc.) and dismisses cleanly.
 *
 * Selection follows the convention from `property-popovers.spec.ts`:
 * `await page.keyboard.press('j')` selects the first row (sets `selectedId`,
 * which gates the property hotkeys via `hasSelection`). Checkbox selection
 * does NOT enable the shortcuts because the `IssueRow` checkbox routes to
 * the page's `setSelectedId` only on click; calling Playwright's `.check()`
 * on the controlled input doesn't always fire React's onChange in the
 * expected order. J is the proven path.
 */
test.describe('Issue Properties via Keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    await page.keyboard.press('j');
    await expect(page.locator('[data-testid="issue-row"]').first()).toHaveAttribute(
      'data-selected',
      'true',
    );
  });

  test('S opens the status selector and selecting an option dismisses it', async ({ page }) => {
    await page.keyboard.press('s');
    const popover = page.locator('[data-testid="status-select-popover"]');
    await expect(popover).toBeVisible();
    await popover.getByRole('button').first().click();
    await expect(popover).not.toBeVisible();
  });

  test('P opens the priority selector and selecting an option dismisses it', async ({ page }) => {
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: /urgent/i }).click();
    await expect(popover).not.toBeVisible();
  });

  test('A opens the assignee selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('a');
    // The assignee popover surfaces a "No assignee" entry that is unique to
    // this popover (the seeded ENG-1 has no assignee).
    const noAssignee = page.getByRole('button', { name: /^No assignee$/ });
    await expect(noAssignee).toBeVisible({ timeout: 5_000 });
    await page.locator('aside').click();
    await expect(noAssignee).not.toBeVisible();
  });

  test('L opens the label selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('l');
    // ENG has no labels seeded, so the popover renders the "No labels" copy.
    const noLabels = page.getByText('No labels', { exact: true });
    await expect(noLabels).toBeVisible({ timeout: 5_000 });
    await page.locator('aside').click();
    await expect(noLabels).not.toBeVisible();
  });

  test('D opens the due date picker and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('d');
    // The due date popover renders a native <input type="date">.
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible({ timeout: 5_000 });
    await page.locator('aside').click();
    await expect(dateInput).not.toBeVisible();
  });

  test('Q opens the cycle selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('q');
    // The cycle popover has a "Search cycles..." placeholder we can target.
    const cycleSearch = page.getByPlaceholder('Search cycles...');
    await expect(cycleSearch).toBeVisible({ timeout: 5_000 });
    await page.locator('aside').click();
    await expect(cycleSearch).not.toBeVisible();
  });

  test('Shift+P opens the project selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('Shift+p');
    const projectSearch = page.getByPlaceholder('Search projects...');
    await expect(projectSearch).toBeVisible({ timeout: 5_000 });
    await page.locator('aside').click();
    await expect(projectSearch).not.toBeVisible();
  });

  test('Shift+E opens the estimate picker and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('Shift+e');
    // ENG has no estimationType configured, so the picker falls back to a
    // numeric input. Either way the popover surfaces an input we can scope on.
    const estimateInput = page.locator('input[type="number"], input[placeholder="0"]').first();
    await expect(estimateInput).toBeVisible({ timeout: 5_000 });
    await page.locator('aside').click();
    await expect(estimateInput).not.toBeVisible();
  });
});
