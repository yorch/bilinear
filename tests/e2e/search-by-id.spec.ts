import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Issue ID instant-jump from the command palette.
 *
 * Typing an exact identifier (e.g. `ENG-1`) and pressing Enter routes
 * straight to that issue's detail page without the user having to arrow-
 * navigate the result list. Implemented by promoting the exact-identifier
 * hit to the top of the issue results and falling back to the first item
 * when no row is highlighted.
 */
test.describe('Search — issue ID instant jump', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('typing an identifier and pressing Enter opens that issue', async ({ page }) => {
    const ws = getWorkspaceKey(page);

    // Pick a known seeded identifier. ENG-1 is created by prisma/seed.ts
    // ("Set up CI/CD pipeline") and is in a non-archived state.
    const identifier = 'ENG-1';

    // Open the command palette via Cmd+K (or Ctrl+K on linux/CI).
    await page.keyboard.press('Control+K');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();

    // Type the identifier — fuzzy search promotes the exact hit to index 0.
    await palette.locator('input').fill(identifier);

    // The first result should be our issue.
    const items = palette.getByTestId('command-palette-item');
    await expect(items.first()).toBeVisible({ timeout: 5_000 });
    await expect(items.first()).toContainText(identifier);

    // Press Enter — the listener falls back to index 0 when nothing is
    // highlighted, so a single Enter jumps without ArrowDown.
    await palette.locator('input').press('Enter');

    // Routed to the issue page; URL should match /<ws>/issue/<uuid>.
    await page.waitForURL(`**/${ws}/issue/**`, { timeout: 10_000 });
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(identifier).first()).toBeVisible();
  });
});
