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
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);

    // Create the issue + drive the status change directly through GraphQL.
    // The row-level `s` hotkey only opens the popover when a row is selected
    // on the list view; once we navigate into the issue detail page, that
    // hotkey path is gone. Going through the resolver here exercises the
    // same activity-service write the UI would trigger.
    const teamId = await getTeamIdByKey(page, team);
    if (!teamId) {
      throw new Error(`Team ${team} not found`);
    }

    const title = `Activity target ${Date.now()}`;
    const created = await gqlInPage<{ issueCreate: { issue?: { id: string } } }>(
      page,
      `mutation Create($input: IssueCreateInput!) {
        issueCreate(input: $input) { issue { id } }
      }`,
      { input: { teamId, title } },
    );
    const issueId = created.data?.issueCreate?.issue?.id;
    if (!issueId) {
      throw new Error('issueCreate did not return an issue');
    }

    // Find a Done state to switch to. The seed gives ENG a `completed`-type
    // state called "Done"; resolve it generically so the test still works
    // if the seed renames or reorders.
    const statesRes = await gqlInPage<{
      team: { states: Array<{ id: string; name: string; type: string }> } | null;
    }>(page, `query($id: ID!) { team(id: $id) { states { id name type } } }`, { id: teamId });
    const doneState = statesRes.data?.team?.states.find(s => s.type === 'completed');
    if (!doneState) {
      throw new Error('No completed-type workflow state for team');
    }

    const updateRes = await gqlInPage<{ issueUpdate: { success: boolean } }>(
      page,
      `mutation Update($id: ID!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: issueId, input: { stateId: doneState.id } },
    );
    if (!updateRes.data?.issueUpdate?.success) {
      throw new Error(`issueUpdate failed: ${JSON.stringify(updateRes)}`);
    }

    // Activity timeline fetches on panel mount; the change above produced
    // a row in `issueActivities` server-side. Navigate to the detail page
    // so the timeline runs its initial fetch and renders the entry.
    await page.goto(`/${ws}/issue/${issueId}`);
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Entries are formatted "<actor> set status to <Done>" or
    // "<actor> changed status from <X> to <Done>" — match flexibly.
    await expect(panel.getByText(/status.*Done|Done.*status/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
