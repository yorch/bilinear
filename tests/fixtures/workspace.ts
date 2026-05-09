import type { Page } from '@playwright/test';

/**
 * Helpers for navigating around the workspace shell. The login flow lands on
 * `/<workspace>/team/<key>`; tests that need to deep-link into other workspace
 * routes can derive the workspace urlKey from the current URL via
 * `getWorkspaceKey(page)` rather than hard-coding `demo`.
 */

/**
 * Read the current workspace urlKey from the page URL. Throws if the page
 * isn't currently in a workspace route — call `loginAs` first.
 */
export function getWorkspaceKey(page: Page): string {
  const match = new URL(page.url()).pathname.match(/^\/([^/]+)\//);
  if (!match) {
    throw new Error(
      `Cannot derive workspace key from URL ${page.url()}. Did you call loginAs first?`,
    );
  }
  return match[1];
}

/**
 * Read the team key (e.g. "ENG") from the current /team/<key> URL.
 * Throws if the page isn't currently on a team-scoped route.
 */
export function getTeamKey(page: Page): string {
  const match = new URL(page.url()).pathname.match(/\/team\/([^/]+)/);
  if (!match) {
    throw new Error(
      `Cannot derive team key from URL ${page.url()}. The current page is not under /team/.`,
    );
  }
  return match[1];
}
