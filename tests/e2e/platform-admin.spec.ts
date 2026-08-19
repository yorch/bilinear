import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_STATE, MEMBER_STATE, openWorkspace } from '../fixtures/auth';
import { gqlInPage } from '../fixtures/graphql';

/**
 * Platform-admin console E2E coverage.
 *
 * The seed marks `e2e@test.local` as a platform admin (isPlatformAdmin=true)
 * while `e2e-member@test.local` is an ordinary org member — so one account
 * exercises the console and the other proves the gate. Authorization-critical
 * assertions go through `gqlInPage` (deterministic, mirrors permissions.spec);
 * the UI checks are lightweight smoke tests on top.
 *
 * Each block declares which seeded session it runs under; both are minted
 * once by the `setup` project, so no test in here logs in. `openWorkspace`
 * is still needed before `gqlInPage` — the fetch runs in the page, so the
 * page has to be on the app origin for the cookies to attach.
 */

const DEMO_USER = 'demo@example.com';

test.describe('Platform admin — authorization', () => {
  test.describe('as a non-admin member', () => {
    test.use({ storageState: MEMBER_STATE });

    test('non-admin platformMetrics is FORBIDDEN', async ({ page }) => {
      await openWorkspace(page);
      const res = await gqlInPage(page, `{ platformMetrics { totalOrgs } }`);
      expect(res.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
    });

    test('non-admin platformTenants is FORBIDDEN', async ({ page }) => {
      await openWorkspace(page);
      const res = await gqlInPage(page, `{ platformTenants { id } }`);
      expect(res.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);
    });
  });

  test.describe('as a platform admin', () => {
    test.use({ storageState: ADMIN_STATE });

    test('platform admin platformMetrics returns cross-tenant data', async ({ page }) => {
      await openWorkspace(page);
      const res = await gqlInPage<{ platformMetrics: { totalOrgs: number; totalUsers: number } }>(
        page,
        `{ platformMetrics { totalOrgs totalUsers } }`,
      );
      expect(res.errors).toBeUndefined();
      expect(res.data?.platformMetrics.totalOrgs).toBeGreaterThanOrEqual(1);
      expect(res.data?.platformMetrics.totalUsers).toBeGreaterThanOrEqual(2);
    });
  });
});

test.describe('Platform admin — console UI', () => {
  test.describe('as a platform admin', () => {
    test.use({ storageState: ADMIN_STATE });

    test('admin opens the console: dashboard, tenants, tenant detail', async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();

      await page.goto('/admin/tenants');
      const demoLink = page.getByRole('link', { name: 'Demo Org' }).first();
      await expect(demoLink).toBeVisible();
      await demoLink.click();

      await page.waitForURL('**/admin/tenants/**');
      await expect(page.getByRole('heading', { name: 'Demo Org' })).toBeVisible();
      await expect(page.getByText('Owners')).toBeVisible();
    });

    test('admin opens the users page', async ({ page }) => {
      await page.goto('/admin/users');
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
      await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
    });
  });

  test.describe('as a non-admin member', () => {
    test.use({ storageState: MEMBER_STATE });

    test('non-admin is redirected away from /admin', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForURL(url => !url.pathname.startsWith('/admin'));
      expect(new URL(page.url()).pathname.startsWith('/admin')).toBe(false);
    });
  });
});

test.describe('Platform admin — impersonation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('admin impersonates a user, is scoped down, and stops', async ({ page }) => {
    await openWorkspace(page);

    // Resolve the demo user + their org through the console API.
    const users = await gqlInPage<{
      platformUsers: Array<{ id: string; email: string; organizations: Array<{ id: string }> }>;
    }>(page, `{ platformUsers { id email organizations { id } } }`);
    const demo = users.data?.platformUsers.find(u => u.email === DEMO_USER);
    expect(demo, 'seeded demo user should exist').toBeTruthy();
    const targetOrgId = demo?.organizations[0]?.id;
    expect(targetOrgId).toBeTruthy();

    // Start impersonation the way the console does (POST the REST route).
    const started = await page.evaluate(
      async ({ userId, orgId }) => {
        const r = await fetch('/api/admin/impersonate', {
          body: JSON.stringify({ orgId, userId }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        return { body: (await r.json()) as { urlKey?: string }, ok: r.ok };
      },
      { orgId: targetOrgId, userId: demo?.id },
    );
    expect(started.ok).toBe(true);
    expect(started.body.urlKey).toBeTruthy();

    // The session is now the target, flagged as impersonated by the admin.
    const state = await gqlInPage<{
      impersonationState: { active: boolean; adminEmail: string | null };
    }>(page, `{ impersonationState { active adminEmail } }`);
    expect(state.data?.impersonationState.active).toBe(true);
    expect(state.data?.impersonationState.adminEmail).toBe(ADMIN_EMAIL);

    // An impersonated session must not wield platform-admin powers.
    const denied = await gqlInPage(page, `{ platformMetrics { totalOrgs } }`);
    expect(denied.errors?.some(e => e.extensions?.code === 'FORBIDDEN')).toBe(true);

    // The workspace shows the banner; its one-click exit restores the admin.
    await page.goto(`/${started.body.urlKey}`);
    await expect(page.getByTestId('impersonation-banner')).toBeVisible();
    await page.getByTestId('stop-impersonating').click();
    await page.waitForURL('**/admin/users**');

    const after = await gqlInPage<{ impersonationState: { active: boolean } }>(
      page,
      `{ impersonationState { active } }`,
    );
    expect(after.data?.impersonationState.active).toBe(false);
  });
});
