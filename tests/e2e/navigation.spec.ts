import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getWorkspaceKey } from '../fixtures/workspace';

/**
 * Sidebar navigation: Inbox, Projects, Initiatives, team sub-routes
 * (Backlog, Cycles, Analytics, Docs).
 *
 * Uses href-prefix selectors against the sidebar nav so the tests stay stable
 * even if the link copy or ordering changes.
 */
test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('navigates to inbox via sidebar', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    await page.locator(`aside nav a[href="/${ws}/inbox"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${ws}/inbox$`));
    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible();
  });

  test('navigates to projects via sidebar', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    await page.locator(`aside nav a[href="/${ws}/projects"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${ws}/projects$`));
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
  });

  test('clicking the team backlog link routes to /team/<key>/backlog', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const backlogLink = page.locator(`aside nav a[href*="/${ws}/team/"][href$="/backlog"]`).first();
    await backlogLink.click();
    await expect(page).toHaveURL(/\/team\/[^/]+\/backlog$/);
  });

  test('clicking the team cycles link routes to /team/<key>/cycles', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const cyclesLink = page.locator(`aside nav a[href*="/${ws}/team/"][href$="/cycles"]`).first();
    await cyclesLink.click();
    await expect(page).toHaveURL(/\/team\/[^/]+\/cycles$/);
    await expect(page.getByRole('heading', { name: /cycles/i })).toBeVisible();
  });

  test('clicking the team analytics link routes to /team/<key>/analytics', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const analyticsLink = page
      .locator(`aside nav a[href*="/${ws}/team/"][href$="/analytics"]`)
      .first();
    await analyticsLink.click();
    await expect(page).toHaveURL(/\/team\/[^/]+\/analytics$/);
  });
});
