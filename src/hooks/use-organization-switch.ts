'use client';

import { useCallback, useState } from 'react';
import { gql } from '@/lib/graphql';
import { ORGANIZATION_SWITCH_MUTATION, VIEWER_ORGANIZATIONS_QUERY } from '@/lib/graphql-queries';
import { createClientLogger } from '@/lib/logger';
import { TransactionQueue } from '@/lib/transaction-queue';
import { gqlError } from '@/lib/utils';

const log = createClientLogger('useOrganizationSwitch');

export interface ViewerOrganization {
  current: boolean;
  id: string;
  logoUrl: string | null;
  name: string;
  role: string;
  urlKey: string;
}

export async function fetchViewerOrganizations(): Promise<ViewerOrganization[]> {
  const result = await gql(VIEWER_ORGANIZATIONS_QUERY);
  if (result.errors?.length) {
    throw new Error(gqlError(result, 'Failed to load workspaces'));
  }
  return (result.data?.viewerOrganizations as ViewerOrganization[]) ?? [];
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
      const result = await gql(ORGANIZATION_SWITCH_MUTATION, { organizationId });
      if (result.errors?.length) {
        throw new Error(gqlError(result, 'Failed to switch workspace'));
      }
      const payload = result.data?.organizationSwitch as {
        accessToken: string;
        refreshToken: string;
        organization: { urlKey: string };
      };

      const session = await fetch('/api/auth/session', {
        body: JSON.stringify({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!session.ok) {
        throw new Error('Failed to establish the new session');
      }

      window.location.assign(destinationFor(payload.organization.urlKey, path));
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
 * Rebase `path` onto `urlKey`'s workspace. Every workspace route is
 * `/<urlKey>/<rest>`, so switching orgs while keeping the same page means
 * swapping the first segment.
 *
 * Anything that isn't a plain absolute in-app path (protocol-relative
 * `//evil.com`, an absolute URL, a bare segment) degrades to the workspace
 * root rather than being pasted into `location.assign` — this value can
 * reach here from a URL the user merely followed, so it is treated as
 * untrusted input.
 */
export function destinationFor(urlKey: string, path?: string): string {
  const root = `/${urlKey}`;
  if (!path?.startsWith('/') || path.startsWith('//')) {
    return root;
  }
  const rest = path.split('/').slice(2).join('/');
  return rest ? `${root}/${rest}` : root;
}
