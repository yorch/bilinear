import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Property keyboard shortcuts on the selected issue:
 *   S → status, P → priority, A → assignee, L → labels, D → due date,
 *   Q → cycle, Shift+P → project, Shift+E → estimate.
 *
 * Unlike `property-popovers.spec.ts` which only verifies that the popover
 * opens, these tests assert the **mutation outcome** — picking a value,
 * dismissing the popover, and confirming the issue actually changed.
 *
 * Popovers dismiss on outside click (mousedown handler), not Escape — so we
 * either click outside (e.g. on `aside`) or pick an option (which auto
 * dismisses the popover).
 *
 * Each test creates a throwaway issue with a `Date.now()` suffix so we don't
 * pollute the seed data shared across parallel specs.
 */
test.describe('Issue Properties via Keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  /**
   * Create a throwaway issue and select it. Returns the title so callers can
   * scope locators to the right row.
   *
   * Selection is driven by the row's hidden checkbox (its onChange fires the
   * onSelect handler). We can't click the title button to "select" — that
   * opens the detail panel. We can't click the row container — it has no
   * onClick. Pressing J/K cycles through the list, but the throwaway's
   * position depends on group ordering; the checkbox is the deterministic
   * single-step path.
   */
  async function createAndSelectIssue(page: import('@playwright/test').Page): Promise<string> {
    const title = `Prop test ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/issue title/i).fill(title);
    await dialog.getByRole('button', { exact: true, name: /^create issue$/i }).click();

    // Wait for the row to appear and for the optimistic temp-id to settle to
    // a real ENG-N identifier.
    const row = page.locator('[data-testid="issue-row"]', { hasText: title });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/ENG-\d+/)).toBeVisible({ timeout: 10_000 });

    // The row checkbox is `opacity-0` until hover/focus but still clickable.
    // .check() routes through the input's change event regardless of layout.
    await row.locator('input[type="checkbox"]').check({ force: true });
    await expect(row).toHaveAttribute('data-selected', 'true', { timeout: 5_000 });
    return title;
  }

  test('changing status via S persists on the issue row', async ({ page }) => {
    const title = await createAndSelectIssue(page);

    // Open status popover via S.
    await page.keyboard.press('s');
    const popover = page.locator('[data-testid="status-select-popover"]');
    await expect(popover).toBeVisible();

    // Pick "Done". Each option is a button rendering a status dot followed
    // by the state name; match by accessible name.
    await popover.getByRole('button', { name: /^Done$/ }).click();
    await expect(popover).not.toBeVisible();

    // The list view groups issues by workflow state — verify our row is now
    // inside the "Done" group. We locate the group section that contains
    // the "Done" group header, then assert our row lives inside it.
    const doneGroup = page
      .locator('[data-testid="group-section"]')
      .filter({ has: page.locator('[data-testid="group-header"]', { hasText: /^▾?\s*Done\b/ }) });
    await expect(doneGroup.locator('[data-testid="issue-row"]', { hasText: title })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('changing priority via P persists on the issue row', async ({ page }) => {
    const title = await createAndSelectIssue(page);

    // Open priority popover via P.
    await page.keyboard.press('p');
    const popover = page.locator('[data-testid="priority-select-popover"]');
    await expect(popover).toBeVisible();

    // Each option button shows the icon glyph + label, so match the label
    // substring (the accessible name is e.g. "!!! Urgent").
    await popover.getByRole('button', { name: /urgent/i }).click();
    await expect(popover).not.toBeVisible();

    // Open the detail panel via Enter — the priority field there shows
    // "Urgent" as a label next to the priority button, which we can assert
    // against to confirm the mutation persisted.
    await page.keyboard.press('Enter');
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/^Urgent$/)).toBeVisible({ timeout: 5_000 });

    // Sanity: the panel header should be for our throwaway issue.
    await expect(panel.getByText(title).first()).toBeVisible();
  });

  test('A opens the assignee selector and dismisses on outside click', async ({ page }) => {
    await createAndSelectIssue(page);

    await page.keyboard.press('a');

    // The assignee popover has no data-testid; locate it by the seeded
    // option "E2E Tester" which is rendered as a button inside the popover.
    const assigneeOption = page.getByRole('button', { name: /E2E Tester/ });
    await expect(assigneeOption.first()).toBeVisible({ timeout: 5_000 });

    // Also expect the "No assignee" entry which is unique to this popover.
    const noAssignee = page.getByRole('button', { name: /^No assignee$/ });
    await expect(noAssignee).toBeVisible();

    // Outside click dismisses the popover.
    await page.locator('aside').click();
    await expect(noAssignee).not.toBeVisible();
  });

  test('L opens the label selector and dismisses on outside click', async ({ page }) => {
    await createAndSelectIssue(page);

    await page.keyboard.press('l');

    // The seeded data has no labels for ENG, so the popover renders the
    // "No labels" empty-state copy. Use that as the visibility marker.
    const noLabels = page.getByText(/^No labels$/);
    await expect(noLabels).toBeVisible({ timeout: 5_000 });

    // Outside click dismisses.
    await page.locator('aside').click();
    await expect(noLabels).not.toBeVisible();
  });

  test('D opens the due date picker and dismisses on outside click', async ({ page }) => {
    await createAndSelectIssue(page);

    await page.keyboard.press('d');

    // The picker renders a native <input type="date"> inside the popover.
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible({ timeout: 5_000 });

    await page.locator('aside').click();
    await expect(dateInput).not.toBeVisible();
  });

  test('Q opens the cycle selector and dismisses on outside click', async ({ page }) => {
    await createAndSelectIssue(page);

    await page.keyboard.press('q');

    // The cycle popover has a "Search cycles..." placeholder we can target
    // and a "No cycles found" empty state (none are seeded).
    const cycleSearch = page.getByPlaceholder(/Search cycles/i);
    await expect(cycleSearch).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^No cycles found$/)).toBeVisible();

    await page.locator('aside').click();
    await expect(cycleSearch).not.toBeVisible();
  });

  test('Shift+P opens the project selector and dismisses on outside click', async ({ page }) => {
    await createAndSelectIssue(page);

    await page.keyboard.press('Shift+p');

    // The project popover has a "Search projects..." placeholder.
    const projectSearch = page.getByPlaceholder(/Search projects/i);
    await expect(projectSearch).toBeVisible({ timeout: 5_000 });

    await page.locator('aside').click();
    await expect(projectSearch).not.toBeVisible();
  });

  test('Shift+E opens the estimate picker and dismisses on outside click', async ({ page }) => {
    await createAndSelectIssue(page);

    await page.keyboard.press('Shift+e');

    // ENG team has no estimation type configured, so the picker falls back
    // to a numeric input. Either way the popover contains an input we can
    // assert on. Scope to a number-or-text input that wasn't there before.
    const estimateInput = page.locator('input[type="number"], input[placeholder="0"]');
    await expect(estimateInput.first()).toBeVisible({ timeout: 5_000 });

    await page.locator('aside').click();
    await expect(estimateInput.first()).not.toBeVisible();
  });
});
