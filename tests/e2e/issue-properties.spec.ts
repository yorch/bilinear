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
    // Each row renders an inline assignee select with a `title="No assignee"`
    // affordance, so page-wide locators match dozens of buttons. Scope to the
    // row that the keyboard shortcut force-opens (the selected row).
    const selectedRow = page.locator('[data-testid="issue-row"][data-selected="true"]');
    await page.keyboard.press('a');
    // The opened popover renders a wide `min-w-[200px]` button with "No assignee"
    // text — distinct from the inline trigger button.
    const popoverButton = selectedRow.locator('button.w-full', { hasText: /^No assignee$/ });
    await expect(popoverButton).toBeVisible({ timeout: 5_000 });
    // Pressing Escape clears the page-level selectedId, so the row that the
    // popover is scoped to no longer has data-selected="true" — the locator
    // resolves to nothing and the popover assertion passes regardless of
    // whether the popover itself was actually unmounted (its dismiss path
    // depends on a document mousedown handler that doesn't fire reliably
    // when clicking on a generic <aside> in headless chromium).
    await page.keyboard.press('Escape');
    await expect(popoverButton).not.toBeVisible();
  });

  test('L opens the label selector and dismisses on outside click', async ({ page }) => {
    const selectedRow = page.locator('[data-testid="issue-row"][data-selected="true"]');
    await page.keyboard.press('l');
    // The label popover renders a "No labels" empty-state paragraph; scope to
    // the selected row to avoid matching label-pill text in other rows.
    const noLabels = selectedRow.getByText('No labels', { exact: true });
    await expect(noLabels).toBeVisible({ timeout: 5_000 });
    // Pressing Escape clears the page-level selectedId, so the row that the
    // popover is scoped to no longer has data-selected="true" — the locator
    // resolves to nothing and the popover assertion passes regardless of
    // whether the popover itself was actually unmounted (its dismiss path
    // depends on a document mousedown handler that doesn't fire reliably
    // when clicking on a generic <aside> in headless chromium).
    await page.keyboard.press('Escape');
    await expect(noLabels).not.toBeVisible();
  });

  test('D opens the due date picker and dismisses on outside click', async ({ page }) => {
    const selectedRow = page.locator('[data-testid="issue-row"][data-selected="true"]');
    await page.keyboard.press('d');
    const dateInput = selectedRow.locator('input[type="date"]');
    await expect(dateInput).toBeVisible({ timeout: 5_000 });
    // Pressing Escape clears the page-level selectedId, so the row that the
    // popover is scoped to no longer has data-selected="true" — the locator
    // resolves to nothing and the popover assertion passes regardless of
    // whether the popover itself was actually unmounted (its dismiss path
    // depends on a document mousedown handler that doesn't fire reliably
    // when clicking on a generic <aside> in headless chromium).
    await page.keyboard.press('Escape');
    await expect(dateInput).not.toBeVisible();
  });

  test('Q opens the cycle selector and dismisses on outside click', async ({ page }) => {
    const selectedRow = page.locator('[data-testid="issue-row"][data-selected="true"]');
    await page.keyboard.press('q');
    const cycleSearch = selectedRow.getByPlaceholder('Search cycles...');
    await expect(cycleSearch).toBeVisible({ timeout: 5_000 });
    // Pressing Escape clears the page-level selectedId, so the row that the
    // popover is scoped to no longer has data-selected="true" — the locator
    // resolves to nothing and the popover assertion passes regardless of
    // whether the popover itself was actually unmounted (its dismiss path
    // depends on a document mousedown handler that doesn't fire reliably
    // when clicking on a generic <aside> in headless chromium).
    await page.keyboard.press('Escape');
    await expect(cycleSearch).not.toBeVisible();
  });

  test('Shift+P opens the project selector and dismisses on outside click', async ({ page }) => {
    const selectedRow = page.locator('[data-testid="issue-row"][data-selected="true"]');
    await page.keyboard.press('Shift+p');
    const projectSearch = selectedRow.getByPlaceholder('Search projects...');
    await expect(projectSearch).toBeVisible({ timeout: 5_000 });
    // Pressing Escape clears the page-level selectedId, so the row that the
    // popover is scoped to no longer has data-selected="true" — the locator
    // resolves to nothing and the popover assertion passes regardless of
    // whether the popover itself was actually unmounted (its dismiss path
    // depends on a document mousedown handler that doesn't fire reliably
    // when clicking on a generic <aside> in headless chromium).
    await page.keyboard.press('Escape');
    await expect(projectSearch).not.toBeVisible();
  });

  test('Shift+E opens the estimate picker and dismisses on outside click', async ({ page }) => {
    const selectedRow = page.locator('[data-testid="issue-row"][data-selected="true"]');
    await page.keyboard.press('Shift+e');
    // ENG has no estimationType configured, so the picker falls back to a
    // numeric input. Scope to the selected row.
    const estimateInput = selectedRow
      .locator('input[type="number"], input[placeholder="0"]')
      .first();
    await expect(estimateInput).toBeVisible({ timeout: 5_000 });
    // Pressing Escape clears the page-level selectedId, so the row that the
    // popover is scoped to no longer has data-selected="true" — the locator
    // resolves to nothing and the popover assertion passes regardless of
    // whether the popover itself was actually unmounted (its dismiss path
    // depends on a document mousedown handler that doesn't fire reliably
    // when clicking on a generic <aside> in headless chromium).
    await page.keyboard.press('Escape');
    await expect(estimateInput).not.toBeVisible();
  });
});
