'use client';

import { useCallback, useState } from 'react';
import { installSessionCookies } from '@/lib/auth-session';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import {
  ORGANIZATION_LEAVE_MUTATION,
  ORGANIZATION_SWITCH_MUTATION,
  VIEWER_ORGANIZATIONS_QUERY,
} from '@/lib/graphql-queries';
import { createClientLogger } from '@/lib/logger';
import { safeRelativePath } from '@/lib/safe-path';
import { TransactionQueue } from '@/lib/transaction-queue';

const log = createClientLogger('useOrganizationSwitch');

export interface ViewerOrganization {
  current: boolean;
  id: string;
  name: string;
  role: string;
}

export async function fetchViewerOrganizations(): Promise<ViewerOrganization[]> {
  // Throws rather than resolving to `[]`: a failed load must not be
  // indistinguishable from "you belong to one workspace", which is what
  // decides whether the switcher renders at all.
  return gqlQuery<ViewerOrganization[]>(VIEWER_ORGANIZATIONS_QUERY, {}, 'viewerOrganizations');
}

/** Number of queued offline mutations that would be discarded by a switch. */
export function pendingWriteCount(): number {
  return TransactionQueue.getPendingIds().size;
}

/**
 * Switch the session to another organization.
 *
 * Three things have to happen in order, and all three matter:
 *
 * 1. `organizationSwitch` re-issues the token pair against the new org —
 *    the session's tenant lives in the signed `orgId` claim, so nothing
 *    changes until the token does.
 * 2. The tokens are installed as httpOnly cookies via `/api/auth/session`,
 *    the same handoff `organizationCreate` and the login flow use. Client
 *    JavaScript never holds the long-lived bearer beyond this call.
 * 3. A **full document load** (`window.location.assign`, not `router.push`)
 *    into the new workspace. A client-side navigation would keep the
 *    running `SyncManager`, MobX stores, and IndexedDB cache of the *old*
 *    org alive; only a fresh document remounts `SyncProvider`, whose
 *    `SyncManager.start()` calls `invalidateCacheIfOrgChanged` and wipes
 *    Dexie before hydrating. Skipping that would leave the previous org's
 *    rows in the stores — cross-tenant data on screen, not just stale UI.
 *
 * `path` lets a caller preserve a deep link (`/acme/team/ENG/…`); it is
 * rewritten onto the destination workspace's url key. Callers pass the path
 * they want to land on *within* the target org.
 */
export function useOrganizationSwitch() {
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = useCallback(async (organizationId: string, path?: string): Promise<void> => {
    setSwitching(organizationId);
    try {
      const payload = await gqlQuery<{
        accessToken: string;
        organization: { urlKey: string };
        refreshToken: string;
      }>(ORGANIZATION_SWITCH_MUTATION, { organizationId }, 'organizationSwitch');

      await enterWorkspace(payload, path);
    } catch (err) {
      // Reset so the trigger is clickable again; the caller surfaces the
      // message. On success we never get here — the document is replaced.
      setSwitching(null);
      log.error('Switch failed', err);
      throw err;
    }
  }, []);

  return { switching, switchTo };
}

/**
 * Give up membership in the current workspace.
 *
 * Ends in the same handoff as a switch — install the re-issued cookies, then a
 * **full document load** — for the same reason spelled out on `switchTo`: only
 * a fresh document remounts `SyncProvider`, and without that the departed
 * workspace's rows stay live in the MobX stores and Dexie. That matters more
 * here than when switching: those rows belong to an org the user can no longer
 * read.
 *
 * The destination differs, though. `organization` is null when nothing
 * remains, and there is no workspace route to land on — so this goes to `/`,
 * which re-derives the redirect from a live membership (onboarding when there
 * are none).
 */
export function useOrganizationLeave() {
  const [leaving, setLeaving] = useState(false);

  const leave = useCallback(async (): Promise<void> => {
    setLeaving(true);
    try {
      const payload = (await gqlMutate(ORGANIZATION_LEAVE_MUTATION)) as {
        organizationLeave?: {
          accessToken: string;
          organization: { urlKey: string } | null;
          refreshToken: string;
        };
      };
      const result = payload.organizationLeave;
      if (!result) {
        throw new Error('Failed to leave the workspace');
      }

      const installed = await installSessionCookies({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      if (!installed) {
        // The membership is already gone — this mutation is not retryable,
        // and a second attempt returns NOT_FOUND. Reporting failure here
        // would tell the user the opposite of what happened and leave them
        // sitting on a cookie for a workspace they are no longer in. Reload
        // through `/` instead: the stale session loses its `orgId` on the
        // next request and the root page re-derives where to go.
        log.error('Left the workspace but could not install the new session');
        window.location.assign('/');
        return;
      }
      window.location.assign(result.organization ? `/${result.organization.urlKey}` : '/');
    } catch (err) {
      // Only reachable on failure — on success the document is replaced.
      setLeaving(false);
      log.error('Leave failed', err);
      throw err;
    }
  }, []);

  return { leave, leaving };
}

/**
 * Install a re-issued token pair and hard-navigate into its workspace.
 *
 * Shared by every path that moves a session from one organization to another
 * — switching workspaces and accepting an invitation — because both have the
 * identical requirement described above: cookies first, then a full document
 * load so `SyncProvider` remounts and wipes the previous org's Dexie cache.
 * Exported so the invitation flow doesn't reimplement it slightly differently.
 */
export async function enterWorkspace(
  payload: {
    accessToken: string;
    refreshToken: string;
    organization: { urlKey: string };
  },
  path?: string,
): Promise<void> {
  const installed = await installSessionCookies({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  });
  if (!installed) {
    throw new Error('Failed to establish the new session');
  }
  window.location.assign(destinationFor(payload.organization.urlKey, path));
}

/**
 * Rebase `path` onto `urlKey`'s workspace. Every workspace route is
 * `/<urlKey>/<rest>`, so switching orgs while keeping the same page means
 * swapping the first segment.
 *
 * Anything `safeRelativePath` rejects (protocol-relative `//evil.com`, an
 * absolute URL, a bare segment) degrades to the workspace root rather than
 * being pasted into `location.assign` — this value can reach here from a URL
 * the user merely followed, so it is treated as untrusted input.
 */
export function destinationFor(urlKey: string, path?: string): string {
  const root = `/${urlKey}`;
  const safe = safeRelativePath(path);
  if (!safe) {
    return root;
  }
  const rest = safe.split('/').slice(2).join('/');
  return rest ? `${root}/${rest}` : root;
}
