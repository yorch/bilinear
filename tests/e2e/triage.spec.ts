import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

/**
 * Triage queue page.
 *
 * The seeded ENG team does not enable triage by default, so the page should
 * render the "Triage is not enabled" message. We assert one of the three
 * known terminal states the page can land on rather than tying ourselves to
 * the seed configuration.
 */
test.describe('Triage', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('triage page renders one of the expected states', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    const notEnabled = page.getByText(/triage is not enabled/i);
    const allClear = page.getByText(/all clear/i);
    const triageHeading = page.getByRole('heading', { name: /triage/i });

    // One of these should be visible — either the heading (when enabled),
    // the all-clear message (when enabled and empty), or the not-enabled
    // explanation (when disabled).
    await expect(notEnabled.or(allClear).or(triageHeading)).toBeVisible({ timeout: 15_000 });
  });
});
