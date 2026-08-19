import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

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
    await openWorkspace(page);
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
    // Pick "Todo" by name rather than first(): the seed's Triage state has
    // position=-1 so it sorts first in the popover, but moving the active
    // issue to Triage hides it from the main list view and breaks sibling
    // specs that look up issues like ENG-1 by title.
    // `getByRole('option')`, not `'button'`: these rows are <button role="option">
    // and an explicit role replaces the implicit one, so a 'button' query cannot
    // match them. They became options when the picker listbox pattern landed
    // (REVIEW_BACKLOG §4.2) and these specs were not updated with them.
    await popover.getByRole('option', { name: /^Todo$/ }).click();
    await expect(popover).not.toBeVisible();
  });

  test('P opens the priority selector and selecting an option dismisses it', async ({ page }) => {
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();
    await popover.getByRole('option', { name: /urgent/i }).click();
    await expect(popover).not.toBeVisible();
  });

  /**
   * Helper: dismiss whichever popover is open by dispatching a document-level
   * mousedown event. All property selects close on the document `mousedown`
   * handler (`if (ref.current && !ref.current.contains(e.target))`), so a
   * synthetic mousedown on document.body reliably triggers the close path
   * without depending on which clickable element happens to be at a given
   * page coordinate. Page-wide locators are used so the assertion remains
   * valid even though `selectedId` may also clear.
   */
  async function dismissPopover(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
  }

  test('A opens the assignee selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('a');
    // The popover container has unique `min-w-[200px]` + `z-50` styling.
    // Match it page-wide so the assertion is valid even after dismiss
    // (when the row may also lose `data-selected`).
    const popover = page.locator('div.absolute.z-50.min-w-\\[200px\\]', {
      has: page.getByRole('option', { name: /^No assignee$/ }),
    });
    await expect(popover).toBeVisible({ timeout: 5_000 });
    await dismissPopover(page);
    await expect(popover).not.toBeVisible({ timeout: 5_000 });
  });

  test('L opens the label selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('l');
    // The label popover renders a "No labels" empty-state paragraph inside
    // its `min-w-[220px]` container; locate the container page-wide.
    const popover = page.locator('div.absolute.z-50', {
      has: page.getByText('No labels', { exact: true }),
    });
    await expect(popover).toBeVisible({ timeout: 5_000 });
    await dismissPopover(page);
    await expect(popover).not.toBeVisible({ timeout: 5_000 });
  });

  test('D opens the due date picker and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('d');
    // The due date popover is the only `input[type="date"]` on the page.
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible({ timeout: 5_000 });
    await dismissPopover(page);
    await expect(dateInput).not.toBeVisible({ timeout: 5_000 });
  });

  test('Q opens the cycle selector and dismisses on outside click', async ({ page }) => {
    await page.keyboard.press('q');
    // The cycle popover's "Search cycles..." placeholder is unique page-wide.
    const cycleSearch = page.getByPlaceholder('Search cycles...');
    await expect(cycleSearch).toBeVisible({ timeout: 5_000 });
    await dismissPopover(page);
    await expect(cycleSearch).not.toBeVisible({ timeout: 5_000 });
  });

  // ProjectSelect is not rendered inside IssueRow today (only the standalone
  // detail panel surfaces project for an issue). Pressing Shift+P sets the
  // page's openProperty='project' but no in-row component reads it, so
  // there's nothing to assert against. Skip until a project popover is
  // wired into the row.
  test.skip('Shift+P opens the project selector and dismisses on outside click', async ({
    page,
  }) => {
    await page.keyboard.press('Shift+p');
    const projectSearch = page.getByPlaceholder('Search projects...');
    await expect(projectSearch).toBeVisible({ timeout: 5_000 });
    await dismissPopover(page);
    await expect(projectSearch).not.toBeVisible({ timeout: 5_000 });
  });

  // EstimatePicker is conditionally rendered: only when the team has an
  // `estimationType` other than 'notUsed'. The seeded ENG team has none, so
  // pressing Shift+E sets openProperty='estimate' but no row component reads
  // it. Skip until the seed configures an estimation type.
  test.skip('Shift+E opens the estimate picker and dismisses on outside click', async ({
    page,
  }) => {
    await page.keyboard.press('Shift+e');
    const estimateInput = page.locator('input[type="number"], input[placeholder="0"]').first();
    await expect(estimateInput).toBeVisible({ timeout: 5_000 });
    await dismissPopover(page);
    await expect(estimateInput).not.toBeVisible({ timeout: 5_000 });
  });
});
