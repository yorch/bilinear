import { expect, test } from '@playwright/test';
import { ADMIN_STATE, openWorkspace } from '../fixtures/auth';

test.use({ storageState: ADMIN_STATE });

/**
 * Optimistic update rollback: TransactionQueue.enqueue exposes an onError
 * callback that fires when the GraphQL mutation returns an `errors[]` payload.
 * The team page's handlers use that callback to undo the optimistic store
 * mutation:
 *
 *   - issueCreate failure  → `issueStore.pool.delete(tempId)` (row vanishes)
 *   - issueUpdate failure  → `issueStore.optimisticUpdate(id, snapshot)`
 *                            (the pre-mutation snapshot is re-applied)
 *
 * We intercept the GraphQL endpoint with `page.route()` and respond with
 * HTTP 200 + a GraphQL-shape `{ data: null, errors: [...] }` body for the
 * targeted operation. That reaches `TransactionQueue.processNext`'s
 * `result.errors?.length` branch, which throws with `permanent: true` and
 * fires `onError` immediately — no 14s retry budget. Stubbing HTTP 500
 * instead would make `gql()` throw before parsing JSON and only exercise
 * the network-failure retry path.
 *
 * Note on toasts: the team page's onError handlers currently only
 * `console.error` — there is no user-facing toast for these particular
 * failures. The assertions therefore focus on the rollback (the row /
 * field returning to its pre-mutation state), which is the actual contract
 * surfaced to the user.
 */
test.describe('Optimistic Update Rollback', () => {
  test.afterEach(async ({ page }) => {
    // Clean up any GraphQL route handlers so they don't leak between tests.
    await page.unroute('**/api/graphql').catch(() => {
      /* no-op if nothing was routed */
    });
  });

  test('server rejection of issue creation rolls back the optimistic row', async ({ page }) => {
    await openWorkspace(page);
    await page.waitForSelector('[data-testid="issue-list-view"]');

    const title = `Rollback create ${Date.now()}`;

    // Intercept ONLY the createIssue mutation; everything else falls through
    // so the bootstrap, sync, and the dialog itself keep working.
    await page.route('**/api/graphql', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes('issueCreate') || body.includes('createIssue')) {
        await route.fulfill({
          body: JSON.stringify({
            data: null,
            errors: [{ extensions: { code: 'INTERNAL' }, message: 'simulated rejection' }],
          }),
          contentType: 'application/json',
          status: 200,
        });
        return;
      }
      await route.continue();
    });

    // Open the create-issue dialog and submit.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: /create issue/i });
    await expect(dialog).toBeVisible();
    const titleInput = dialog.getByPlaceholder(/issue title/i);
    await titleInput.fill(title);
    await titleInput.press('Enter');

    // The optimistic phase may be too brief to assert on reliably (the queue
    // can resolve the rejection before Playwright's next tick), so skip
    // asserting "title appears" and go straight to the final-state check.

    // Final state: the title must NOT remain in the list. The 200 + errors[]
    // response triggers the permanent-failure branch in TransactionQueue,
    // so onError fires immediately without retries.
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 5_000 });
  });

  test('server rejection of status change rolls back the issue state', async ({ page }) => {
    await openWorkspace(page);
    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Pick whichever issue is currently first in the list. Sibling specs may
    // have archived ENG-1 ("Set up CI/CD pipeline") so we discover the title
    // and current group rather than hardcoding the seed.
    const firstRow = page.locator('[data-testid="issue-row"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    // Addressed by test id, not by layout class: the row moved from flex to a
    // grid template so the properties line up between rows, and `button.flex-1`
    // silently stopped matching.
    const targetTitle =
      (await firstRow.locator('[data-testid="issue-row-title"]').textContent())?.trim() ?? '';
    expect(targetTitle.length).toBeGreaterThan(0);

    // Discover the row's starting group section by walking up to the
    // ancestor [data-testid="group-section"] and reading its header text.
    const startingGroup = page
      .locator('[data-testid="group-section"]')
      .filter({ hasText: targetTitle })
      .first();
    const startingHeader =
      (await startingGroup.locator('[data-testid="group-header"]').textContent())?.trim() ?? '';
    // Header text looks like "▾ Todo 3" — extract the workflow state name.
    const startingStateName = startingHeader
      .replace(/^▾\s*/, '')
      .replace(/\s+\d+$/, '')
      .trim();
    expect(startingStateName.length).toBeGreaterThan(0);

    // Pick a target state distinct from the starting one. "Done" is fine
    // unless the row already lives there; in that case fall back to "Todo".
    const targetStateName = startingStateName.toLowerCase() === 'done' ? 'Todo' : 'Done';

    const row = firstRow;

    // Now intercept ONLY issueUpdate mutations whose body mentions stateId.
    // Other mutations (e.g. unrelated sync calls) keep working.
    await page.route('**/api/graphql', async route => {
      const body = route.request().postData() ?? '';
      const isUpdateWithState =
        (body.includes('issueUpdate') || body.includes('updateIssue')) && body.includes('stateId');
      if (isUpdateWithState) {
        await route.fulfill({
          body: JSON.stringify({
            data: null,
            errors: [{ extensions: { code: 'INTERNAL' }, message: 'simulated rejection' }],
          }),
          contentType: 'application/json',
          status: 200,
        });
        return;
      }
      await route.continue();
    });

    // Select the issue (J highlights the first row in the list) and open
    // the status popover via the S shortcut.
    await page.keyboard.press('j');
    await expect(row).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('s');

    const popover = page.locator('[data-testid="status-select-popover"]');
    await expect(popover).toBeVisible();

    // Pick a different workflow state. The popover lists every state by name.
    // `getByRole('option')`, not `'button'`: these rows are <button role="option">
    // and an explicit role replaces the implicit one, so a 'button' query cannot
    // match them. They became options when the picker listbox pattern landed
    // (REVIEW_BACKLOG §4.2) and these specs were not updated with them.
    await popover.getByRole('option', { name: new RegExp(`^${targetStateName}$`, 'i') }).click();
    await expect(popover).not.toBeVisible();

    // Final state: after the GraphQL `errors[]` response trips the permanent-
    // failure branch the snapshot is re-applied, so the row should NOT remain
    // under the target group; it must end up back under its starting group.
    // No retry budget — onError fires on the first response.
    const targetGroup = page.locator('[data-testid="group-section"]').filter({
      has: page.locator('[data-testid="group-header"]', {
        hasText: new RegExp(`^▾?\\s*${targetStateName}`, 'i'),
      }),
    });
    const startingGroupAfter = page.locator('[data-testid="group-section"]').filter({
      has: page.locator('[data-testid="group-header"]', {
        hasText: new RegExp(`^▾?\\s*${startingStateName}`, 'i'),
      }),
    });

    await expect(targetGroup.getByText(targetTitle)).toHaveCount(0, { timeout: 5_000 });
    await expect(startingGroupAfter.getByText(targetTitle)).toBeVisible({ timeout: 5_000 });
  });
});
