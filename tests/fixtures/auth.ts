import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** Seeded accounts. `ADMIN` is an org admin *and* a platform admin. */
export const ADMIN_EMAIL = 'e2e@test.local';
export const MEMBER_EMAIL = 'e2e-member@test.local';

/**
 * Where the `setup` project parks each account's cookies. Specs that only
 * need "a logged-in admin" declare `test.use({ storageState: ADMIN_STATE })`
 * and call `openWorkspace(page)` instead of paying for a magic-link round
 * trip per test — see the note on `openWorkspace`.
 *
 * Absolute, so every worker resolves the same file. It is built from
 * `process.cwd()` rather than `import.meta.url` because playwright loads
 * these modules as CommonJS, where `import.meta` is a syntax error — and
 * `yarn test:e2e` always runs from the package root.
 */
const stateFile = (name: string) => join(process.cwd(), 'tests', '.auth', `${name}.json`);

export const ADMIN_STATE = stateFile('admin');
export const MEMBER_STATE = stateFile('member');

/**
 * Log in as `email` via the magic-link email flow.
 *
 * Requires the dev server to be started with:
 *   NODE_ENV=test TEST_AUTH_CODE=000000
 *
 * When NODE_ENV is not production and TEST_AUTH_CODE is set,
 * AuthService.verifyMagicLink accepts that code for any email without
 * checking the database, making E2E auth deterministic. The
 * playwright.config.ts webServer sets these env vars automatically.
 *
 * NOTE: VerifyCodeForm auto-submits when a 6-digit code is entered via
 * onChange — no button click is needed or safe here (clicking the button
 * after auto-submit navigates the page and throws a detach error).
 *
 * Prefer `storageState` + `openWorkspace` for specs that merely need to be
 * signed in; this helper is for the specs that are *about* signing in, and
 * for `tests/e2e/auth.setup.ts` which mints the shared states.
 */
export async function loginAs(page: Page, email: string, code?: string) {
  const verifyCode = code ?? process.env.TEST_AUTH_CODE ?? '000000';

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByTestId('email-submit').click();

  // Wait for the verify page
  await page.waitForURL('**/verify**');
  // Filling a 6-digit code triggers handleCodeChange which auto-submits the form.
  await page.getByLabel(/code/i).fill(verifyCode);

  // Should land on the team issues page (past all workspace redirects)
  await page.waitForURL('**/team/**', { timeout: 30_000 });

  await waitForBootstrap(page);
}

/**
 * Enter the workspace as whoever the browser context is already signed in as.
 *
 * `/` resolves the session's org and redirects to `/<workspace>`, which in
 * turn redirects to that workspace's first team — the same URL `loginAs`
 * lands on, so `getWorkspaceKey`/`getTeamKey` work identically after either.
 *
 * This is one navigation instead of `loginAs`'s three (login → verify →
 * workspace) plus two mutations, which is most of the per-test cost in a
 * suite where nearly every spec only needs "a signed-in admin".
 */
export async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.waitForURL('**/team/**', { timeout: 30_000 });
  await waitForBootstrap(page);
}

/**
 * Wait for the sync bootstrap to settle so the issue list (or its empty
 * state) is on screen before any test interaction. Without this, tests that
 * press keyboard shortcuts or look for issue rows race the loading state.
 */
async function waitForBootstrap(page: Page) {
  await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]', {
    timeout: 30_000,
  });
}

/**
 * Ensure the test user is logged out.
 */
export async function logout(page: Page) {
  await page.goto('/api/auth/logout');
}
