import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_STATE, loginAs, MEMBER_EMAIL, MEMBER_STATE } from '../fixtures/auth';

/**
 * Mint one signed-in session per seeded account and park it on disk.
 *
 * This runs once as the `setup` project that every browser project depends
 * on. Specs then declare `test.use({ storageState: ADMIN_STATE })` and start
 * from an authenticated context, which turns each test's login from three
 * navigations plus two mutations into a single `page.goto('/')`.
 *
 * Sharing one session across the suite is safe here: access tokens live 24h
 * (`ACCESS_TOKEN_EXPIRY` in `src/server/lib/jwt.ts`), so no test triggers a
 * refresh-token rotation that could invalidate the family for its siblings,
 * and `issueTokenPair` starts a *new* family per login rather than revoking
 * existing ones — so the specs that still log in for real (auth, logout,
 * sync) cannot knock the shared sessions over.
 *
 * The file is named `.setup.ts`, not `.spec.ts`, so the browser projects'
 * default `testMatch` never picks it up as an ordinary test.
 */

setup('authenticate as org admin', async ({ page }) => {
  mkdirSync(dirname(ADMIN_STATE), { recursive: true });
  await loginAs(page, ADMIN_EMAIL);
  await page.context().storageState({ path: ADMIN_STATE });
});

setup('authenticate as org member', async ({ page }) => {
  mkdirSync(dirname(MEMBER_STATE), { recursive: true });
  await loginAs(page, MEMBER_EMAIL);
  await page.context().storageState({ path: MEMBER_STATE });
});
