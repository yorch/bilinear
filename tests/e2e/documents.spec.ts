import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

/**
 * Documents — team-scoped doc creation and edit roundtrip.
 *
 * The team docs page renders DocumentList; clicking "New Document" creates a
 * doc via GraphQL and navigates to /<ws>/docs/<id>. The editor auto-saves
 * title changes after a 1s debounce; a reload then loads the saved title via
 * the sync bootstrap.
 */
test.describe('Documents', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('docs page renders and creates a new document', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);

    await page.goto(`/${ws}/team/${team}/docs`);

    // Page heading reflects the team.
    await expect(page.getByRole('heading', { name: /Docs/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Clicking "New Document" creates a doc and routes to /docs/<id>.
    await page.getByRole('button', { name: /^new document/i }).click();
    await page.waitForURL(`**/${ws}/docs/**`, { timeout: 10_000 });

    // Editor renders with the default Untitled placeholder.
    const titleInput = page.locator('input[placeholder="Untitled"]');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
  });

  test('editing the title persists across reload', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);

    await page.goto(`/${ws}/team/${team}/docs`);
    await expect(page.getByRole('heading', { name: /Docs/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /^new document/i }).click();
    await page.waitForURL(`**/${ws}/docs/**`, { timeout: 10_000 });

    const titleInput = page.locator('input[placeholder="Untitled"]');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    const title = `Doc title ${Date.now()}`;
    await titleInput.fill(title);

    // Auto-save debounces 1s; wait long enough for the mutation + WS update.
    await page.waitForTimeout(2_000);

    await page.reload();
    await expect(page.locator('input[placeholder="Untitled"]')).toHaveValue(title, {
      timeout: 15_000,
    });
  });
});
