import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';
import { getTeamIdByKey, gqlInPage } from '../fixtures/graphql';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

test.use({ storageState: ADMIN_STATE });

/**
 * Custom fields — define a text field on a team and verify it renders on
 * the issue detail panel.
 *
 * Drives the create-definition flow through the UI on team settings, then
 * opens an issue detail panel to confirm the new field surfaces in the
 * `Custom fields` section. Cleanup is best-effort via `customFieldDefinition
 * Archive` so repeated test runs don't pile up MAX_FIELDS rows on the team.
 */
test.describe('Custom fields', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('admin can define a custom field and it renders on issue detail', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);

    await page.goto(`/${ws}/team/${team}/settings`);
    // Settings page renders a "Custom fields" section heading.
    const section = page.getByRole('heading', { name: /custom fields/i });
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Open the inline form and fill it.
    await page.getByRole('button', { name: /^add field$/i }).click();
    const fieldName = `Severity ${Date.now()}`;
    await page.locator('#cf-name').fill(fieldName);
    // Type defaults to "text" — leave it.
    await page.getByRole('button', { name: /^add field$/i }).click();

    // The new field appears in the list.
    await expect(page.getByText(fieldName)).toBeVisible({ timeout: 10_000 });

    // Capture its id by name (not by array position) so cleanup targets the
    // definition this test created even when other definitions exist or
    // the resolver reorders results.
    const teamId = await getTeamIdByKey(page, team);
    let definitionId: string | null = null;
    if (teamId) {
      const defsRes = await gqlInPage<{
        customFieldDefinitions: Array<{ id: string; name: string }>;
      }>(page, `query($teamId: ID!) { customFieldDefinitions(teamId: $teamId) { id name } }`, {
        teamId,
      });
      definitionId =
        defsRes.data?.customFieldDefinitions.find(d => d.name === fieldName)?.id ?? null;
    }

    // Open the seeded ENG-1 issue and verify the new field shows up in the
    // Custom fields editor section.
    await page.goto(`/${ws}/team/${team}`);
    await page.waitForSelector('[data-testid="issue-list-view"]');
    const titleButton = page
      .locator('[data-testid="issue-row"]', { hasText: 'Set up CI/CD pipeline' })
      .getByRole('button', { exact: true, name: 'Set up CI/CD pipeline' });
    await titleButton.click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Custom fields', { exact: false })).toBeVisible({
      timeout: 10_000,
    });
    await expect(panel.getByText(fieldName)).toBeVisible({ timeout: 10_000 });

    // Cleanup: archive the definition so the team doesn't approach MAX_FIELDS
    // across runs. Failures here are non-fatal — the test already passed.
    if (definitionId) {
      await gqlInPage(
        page,
        `mutation($id: ID!) { customFieldDefinitionArchive(id: $id) { success } }`,
        { id: definitionId },
      );
    }
  });
});
