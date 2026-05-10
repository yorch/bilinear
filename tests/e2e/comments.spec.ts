import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getTeamIdByKey, gqlInPage } from '../fixtures/graphql';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

/**
 * Comments + activity timeline.
 *
 * Posts a comment via the GraphQL `commentCreate` mutation (rather than
 * typing into the TipTap editor) so the test verifies the read-back path in
 * the detail panel without coupling to the editor's contenteditable
 * behavior. The activity timeline test uses the keyboard-driven status
 * shortcut so the e2e signal exercises the resolver → service → activity-
 * service path that produces the timeline entry.
 */
test.describe('Comments + Activity', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
  });

  test('posting a comment renders in the issue detail panel', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);

    // Create a fresh issue via direct GraphQL so we don't pollute seeded
    // data and don't couple the test to the create modal's behavior.
    const title = `Comment target ${Date.now()}`;
    const teamId = await getTeamIdByKey(page, team);
    if (!teamId) {
      throw new Error(`Team ${team} not found`);
    }
    const createRes = await gqlInPage<{
      issueCreate: { issue?: { id: string; identifier: string } };
    }>(
      page,
      `mutation Create($input: IssueCreateInput!) {
        issueCreate(input: $input) { issue { id identifier } }
      }`,
      { input: { teamId, title } },
    );
    const created = createRes.data?.issueCreate?.issue;
    if (!created) {
      throw new Error('issueCreate did not return an issue');
    }

    // Post a comment via the same GraphQL surface the UI uses. We don't
    // type into TipTap because it would race with the lazy-loaded editor
    // module's contenteditable initialization.
    const body = `<p>E2E comment ${Date.now()}</p>`;
    const commentRes = await gqlInPage<{ commentCreate: { success: boolean } }>(
      page,
      `mutation Create($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id body } }
      }`,
      { input: { body, issueId: created.id, parentId: null } },
    );
    if (!commentRes.data?.commentCreate?.success) {
      throw new Error(`commentCreate failed: ${JSON.stringify(commentRes)}`);
    }

    // Navigate directly to the issue page so the detail panel mounts and
    // CommentThread fetches the freshly-posted comment via gql().
    await page.goto(`/${ws}/issue/${created.id}`);
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The comment body is rendered via TipTap so the literal HTML doesn't
    // appear — but the inner text "E2E comment <ts>" does.
    const expectedText = body.replace(/<[^>]+>/g, '');
    await expect(panel.getByText(expectedText)).toBeVisible({ timeout: 10_000 });
  });

  test('activity timeline shows an entry after a status change', async ({ page }) => {
    const team = getTeamKey(page);

    // Create a fresh issue and stash its identifier to drive the keyboard
    // shortcut path.
    const title = `Activity target ${Date.now()}`;
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
    await dialog.getByPlaceholder(/issue title/i).fill(title);
    await dialog.getByPlaceholder(/issue title/i).press('Enter');
    await expect(dialog).not.toBeVisible();

    const row = page.locator('[data-testid="issue-row"]', { hasText: title });
    await expect(row.getByText(/ENG-\d+/)).toBeVisible({ timeout: 10_000 });

    // Open the detail panel via the title button so the activity timeline
    // mounts and fetches the initial (creation) state.
    await row.getByRole('button', { exact: true, name: title }).click();
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible();

    // Wait for the timeline section to render. It either shows "No activity
    // recorded yet." or one or more activity rows, depending on whether the
    // service backfills a creation entry.
    const activitySection = panel.locator('text=/Activity/i').first();
    await expect(activitySection).toBeVisible();

    // Drive a status change via the S hotkey on the open detail panel.
    // Blur any focused input first so useHotkeys doesn't swallow the key.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    void team;
    await page.keyboard.press('s');
    const statusPopover = page.getByTestId('status-select-popover');
    await expect(statusPopover).toBeVisible();
    await statusPopover.getByText('Done', { exact: true }).click();
    await expect(statusPopover).not.toBeVisible();

    // The timeline refetches after the mutation lands. Activity entries are
    // formatted "<actor> set status to <Done>" or "<actor> changed status
    // from <X> to <Done>" — match flexibly on "status" + "Done".
    await expect(panel.getByText(/status.*Done|Done.*status/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
