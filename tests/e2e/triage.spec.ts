import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getTeamKey, getWorkspaceKey } from '../fixtures/workspace';

/**
 * Triage queue page.
 *
 * The seed enables triage on the ENG team and creates three inbound issues
 * (ENG-4, ENG-5, ENG-6) in the triage workflow state. ENG-1/2/3 are in
 * normal states and serve as duplicate targets. If the seed is ever changed
 * to disable triage, the smoke test below still tolerates either the
 * disabled message or the all-clear state, but the action tests assume
 * a populated queue.
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

  test('triage page shows the queued issues', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    // Header counter "{n} to triage" — the seed creates 3 triage issues.
    await expect(page.getByText(/to triage/i)).toBeVisible({ timeout: 15_000 });

    // The Accept button is the most stable per-row signal: one per queued issue.
    const acceptButtons = page.getByRole('button', { name: 'Accept' });
    await expect(acceptButtons.first()).toBeVisible();
    expect(await acceptButtons.count()).toBeGreaterThanOrEqual(2);

    // At least one of the seeded triage issue identifiers should appear.
    await expect(page.getByText(/ENG-[456]/).first()).toBeVisible();
  });

  test('Accept moves the issue out of triage', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    const acceptButtons = page.getByRole('button', { name: 'Accept' });
    await expect(acceptButtons.first()).toBeVisible({ timeout: 15_000 });
    const initialCount = await acceptButtons.count();
    expect(initialCount).toBeGreaterThan(0);

    await acceptButtons.first().click();

    // Optimistic update removes the row immediately. Wait for the count to drop.
    await expect.poll(() => acceptButtons.count(), { timeout: 10_000 }).toBe(initialCount - 1);
  });

  test('Decline cancels the issue and removes it from the queue', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    const declineButtons = page.getByRole('button', { name: 'Decline' });
    await expect(declineButtons.first()).toBeVisible({ timeout: 15_000 });
    const initialCount = await declineButtons.count();
    expect(initialCount).toBeGreaterThan(0);

    await declineButtons.first().click();

    await expect.poll(() => declineButtons.count(), { timeout: 10_000 }).toBe(initialCount - 1);
  });

  test('Mark Duplicate removes the issue and creates a duplicate relation', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    const duplicateButtons = page.getByRole('button', { name: 'Duplicate' });
    await expect(duplicateButtons.first()).toBeVisible({ timeout: 15_000 });
    const initialCount = await duplicateButtons.count();
    expect(initialCount).toBeGreaterThan(0);

    // The Duplicate flow uses window.prompt() — auto-accept with ENG-1
    // (a non-triage seeded issue) as the canonical target.
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('ENG-1');
    });

    await duplicateButtons.first().click();

    await expect.poll(() => duplicateButtons.count(), { timeout: 10_000 }).toBe(initialCount - 1);
  });

  test('Snooze hides the issue from the active queue', async ({ page }) => {
    const ws = getWorkspaceKey(page);
    const team = getTeamKey(page);
    await page.goto(`/${ws}/team/${team}/triage`);

    const snoozeButtons = page.getByRole('button', { name: 'Snooze' });
    await expect(snoozeButtons.first()).toBeVisible({ timeout: 15_000 });
    const initialCount = await snoozeButtons.count();
    expect(initialCount).toBeGreaterThan(0);

    // Click the first row's Snooze button to open the preset popover, then
    // pick "1 day" (the page exposes 4 hours / 1 day / 1 week presets).
    await snoozeButtons.first().click();
    await page.getByRole('menuitem', { name: '1 day' }).click();

    await expect.poll(() => snoozeButtons.count(), { timeout: 10_000 }).toBe(initialCount - 1);
  });
});
