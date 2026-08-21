import { expect, test } from '@playwright/test';
import { ADMIN_STATE, MEMBER_STATE, openWorkspace } from '../fixtures/auth';
import { gqlInPage } from '../fixtures/graphql';

/**
 * The configuration console, end to end.
 *
 * Unit tests cover resolution and the authorization rules, and
 * `yarn db:verify:config` covers what a Prisma mock cannot. What neither
 * covers is the loop this feature exists to close: a platform admin changes a
 * value in the browser, the server stores it, and the console reports where
 * the value now comes from. That provenance line is the whole product — a
 * console that shows a value without saying which layer supplied it is the
 * thing this replaced.
 *
 * `cycles.upcomingCount` is the knob under test because it is an integer with
 * bounds, it declares platform scope, and it is `org-admin` editable — the
 * combination that a platform admin must still be able to write here, and that
 * a `editableBy === 'platform-admin'` comparison silently rendered read-only.
 *
 * **Cleanup is this spec's own job.** `cleanup.teardown.ts` archives issues; it
 * knows nothing about `settings`, and a platform-scope row left behind changes
 * the default for every tenant on the next run. Every test that writes clears
 * what it wrote.
 */

const KNOB = 'cycles.upcomingCount';

/**
 * Restore the knob to inherited, whatever the test left behind.
 *
 * The result is asserted, not discarded. An unchecked `errors[]` is how this
 * repo's issue teardown twice reported "nothing to clean up" while leaving rows
 * behind — and here the row is PLATFORM scope, so a leak changes the default
 * for every tenant on the next run with no other backstop.
 */
async function clearKnob(page: import('@playwright/test').Page) {
  const res = await gqlInPage(
    page,
    `mutation { settingClear(key: "${KNOB}", scope: platform) { success } }`,
  );
  expect(
    res.errors,
    `settingClear failed; ${KNOB} may be left set at platform scope`,
  ).toBeUndefined();
}

test.describe('Configuration console — authorization', () => {
  test.describe('as a non-admin member', () => {
    test.use({ storageState: MEMBER_STATE });

    test('platform-scope settings are not readable', async ({ page }) => {
      await openWorkspace(page);
      const res = await gqlInPage(page, `{ settings(scope: platform) { key } }`);
      expect(res.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
    });

    test('a platform-scope write is refused', async ({ page }) => {
      // The escalation this system shipped with: `cycles.upcomingCount` is
      // org-admin editable, so the knob-level check alone let any tenant's
      // admin write every other tenant's default.
      await openWorkspace(page);
      const res = await gqlInPage(
        page,
        `mutation { settingSet(input: { key: "${KNOB}", scope: platform, value: 99 }) { success } }`,
      );
      expect(res.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
    });

    test('the console itself is unreachable', async ({ page }) => {
      await page.goto('/admin/config');
      // The (admin) layout redirects a non-platform-admin before the page renders.
      await expect(page).not.toHaveURL(/\/admin\/config/);
    });
  });
});

test.describe('Configuration console — as a platform admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test.afterEach(async ({ page }) => {
    await openWorkspace(page);
    await clearKnob(page);
  });

  test('a write is stored, reported as set here, and reset to inherited', async ({ page }) => {
    await page.goto('/admin/config');
    await expect(page.getByRole('heading', { name: 'Platform configuration' })).toBeVisible();

    const row = page.getByTestId(`setting-row-${KNOB}`);
    const field = row.getByRole('spinbutton', { name: 'Upcoming cycles kept ready' });
    await expect(field).toBeVisible();

    // Inherited to begin with: nothing is stored, so the code default supplies it.
    await expect(row).toContainText('Inherited from');

    await field.fill('7');
    await field.blur();

    // The server returns the RE-RESOLVED row, so this asserts the round trip
    // rather than an optimistic local edit.
    await expect(row).toContainText('Set here');
    await expect(field).toHaveValue('7');

    const stored = await gqlInPage<{ setting: { source: string; value: number } }>(
      page,
      `{ setting(key: "${KNOB}", scope: platform) { source value } }`,
    );
    expect(stored.data?.setting.source).toBe('platform');
    expect(stored.data?.setting.value).toBe(7);

    // "Reset to inherited" only appears once this scope stores a row, which is
    // the distinction between clearing and writing the default back.
    await row.getByRole('button', { name: 'Reset to inherited' }).click();
    await expect(row).toContainText('Inherited from');
  });

  test('an env-backed knob renders locked and names its variable', async ({ page }) => {
    await page.goto('/admin/config');
    // `env.*` knobs are `storage: 'env-only'` — nothing stored can take effect,
    // so accepting a write would appear to succeed and do nothing.
    const row = page.getByTestId('setting-row-env.APP_URL');
    await expect(row).toContainText('Forced by APP_URL');
    await expect(row.getByRole('textbox')).toBeDisabled();
  });

  test('a secret renders as presence only, with no control bound to it', async ({ page }) => {
    // The GraphQL half is asserted below; this is the DOM half. Without it a
    // regression that rendered a secret into an editable `Input` would leave
    // this suite green, because nothing else navigates to the redacted row.
    await page.goto('/admin/config');
    const row = page.getByTestId('setting-row-env.JWT_SECRET');
    await expect(row).toContainText('Set');
    await expect(row.getByRole('textbox')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Reset to inherited' })).toHaveCount(0);
  });

  test('a secret never sends its value to the browser', async ({ page }) => {
    await openWorkspace(page);
    const res = await gqlInPage<{ setting: { envIsSet: boolean; redacted: boolean; value: null } }>(
      page,
      `{ setting(key: "env.JWT_SECRET", scope: platform) { redacted envIsSet value } }`,
    );
    expect(res.data?.setting.redacted).toBe(true);
    expect(res.data?.setting.envIsSet).toBe(true);
    expect(res.data?.setting.value).toBeNull();
    // The whole response, not just the field: a secret must not ride along
    // anywhere in the payload.
    expect(JSON.stringify(res)).not.toContain(process.env.JWT_SECRET ?? '__unset__');
  });

  test('an out-of-bounds value is refused by the registry, not stored', async ({ page }) => {
    await openWorkspace(page);
    const res = await gqlInPage(
      page,
      `mutation { settingSet(input: { key: "${KNOB}", scope: platform, value: 10000 }) { success } }`,
    );
    expect(res.errors?.some(e => e.extensions?.code === 'BAD_USER_INPUT')).toBe(true);

    const after = await gqlInPage<{ setting: { source: string } }>(
      page,
      `{ setting(key: "${KNOB}", scope: platform) { source } }`,
    );
    expect(after.data?.setting.source).toBe('code-default');
  });
});
