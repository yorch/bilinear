import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

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
 * To exercise these paths deterministically we intercept the GraphQL endpoint
 * with `page.route()` and reply 500 only for the specific operation under
 * test. This lets the bootstrap, sync, and unrelated mutations succeed
 * normally while still forcing the targeted mutation to fail permanently.
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
    await loginAs(page, 'e2e@test.local');
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
          status: 500,
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

    // Final state: the title must NOT remain in the list. TransactionQueue
    // retries up to 3 times before the error is treated as permanent (only
    // `permanent: true` skips the retry path, and we don't set that here),
    // so allow a generous timeout for the rollback to settle. The retry
    // schedule is 1s + 3s + 10s ≈ 14s.
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 20_000 });
  });

  test('server rejection of status change rolls back the issue state', async ({ page }) => {
    await loginAs(page, 'e2e@test.local');
    await page.waitForSelector('[data-testid="issue-list-view"]');

    // Pick the first seeded issue (ENG-1, "Set up CI/CD pipeline", state = Todo).
    const targetTitle = 'Set up CI/CD pipeline';
    const row = page.locator('[data-testid="issue-row"]', { hasText: targetTitle });
    await expect(row).toBeVisible();

    // Confirm the starting group: the "Todo" group section should contain
    // this row before we attempt any mutation.
    const todoGroup = page
      .locator('[data-testid="group-section"]')
      .filter({ has: page.locator('[data-testid="group-header"]', { hasText: /^Todo/i }) });
    await expect(todoGroup.getByText(targetTitle)).toBeVisible();

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
          status: 500,
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

    // Pick a different state ("Done"). The popover lists every workflow
    // state by name, so match by accessible name.
    await popover.getByRole('button', { name: /^Done$/i }).click();
    await expect(popover).not.toBeVisible();

    // Final state: after the queue exhausts retries the snapshot is
    // re-applied, so the row should NOT remain under the Done group; it
    // must end up back under "Todo". TransactionQueue retry schedule is
    // 1s + 3s + 10s before treating the failure as permanent, so allow up
    // to ~20s for the rollback to settle.
    const doneGroup = page
      .locator('[data-testid="group-section"]')
      .filter({ has: page.locator('[data-testid="group-header"]', { hasText: /^Done/i }) });

    await expect(doneGroup.getByText(targetTitle)).toHaveCount(0, { timeout: 20_000 });
    await expect(todoGroup.getByText(targetTitle)).toBeVisible({ timeout: 20_000 });
  });
});
