'use client';

import { useEffect, useRef } from 'react';
import { SyncManager } from '@/lib/sync-manager';
import { TransactionQueue } from '@/lib/transaction-queue';
import { WsClient } from '@/lib/ws-client';
import { useStore } from './store-provider';

/**
 * Bootstraps data and maintains the WebSocket sync connection.
 * Must be rendered inside StoreProvider.
 *
 * Requires the access token to be available as a cookie (handled by the
 * existing auth flow). We read it via a lightweight session API call.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const syncManagerRef = useRef<SyncManager | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Keep a local ref so cleanup can stop the manager even if the ref
    // assignment races with StrictMode's unmount/remount cycle.
    let localManager: SyncManager | null = null;

    async function init() {
      // Fetch the current access token from the session endpoint
      // The session route returns the token from the httpOnly cookie
      const res = await fetch('/api/auth/session', {
        credentials: 'include',
        method: 'GET',
      });
      if (!res.ok || cancelled) {
        return;
      }

      const data = (await res.json()) as { token?: string };
      if (!data.token || cancelled) {
        return;
      }

      // Decode the access token's claims (no signature check — the cookie
      // was already validated by the server) to scope the TransactionQueue
      // to this session. Without this, a sign-out + sign-in on the same
      // browser would replay the previous user's pending mutations under
      // the new user's auth cookies.
      const session = decodeSessionFromToken(data.token);
      if (session) {
        TransactionQueue.setActiveSession(session);
      }

      const wsClient = new WsClient();
      const syncManager = new SyncManager(store, wsClient);
      localManager = syncManager;
      syncManagerRef.current = syncManager;

      await syncManager.start(data.token);

      // Replay any mutations that were queued in a previous session and
      // didn't drain before the page closed (or crashed). Filters to the
      // active session so cross-user rows are dropped instead of replayed.
      // Runs after bootstrap/delta sync so reconciliation has the latest
      // server state — if the server already accepted a queued mutation,
      // the retry becomes a no-op (mutations are idempotent on identifier
      // conflict) or surfaces a permanent error which drops the row.
      if (session) {
        void TransactionQueue.hydrate(session);
      }
    }

    init().catch(err => {
      console.error('[SyncProvider] Init error:', err);
    });

    return () => {
      cancelled = true;
      // Stop via local ref to handle the race where cleanup fires before
      // syncManagerRef.current is assigned (React StrictMode double-invoke).
      (localManager ?? syncManagerRef.current)?.stop();
      localManager = null;
    };
  }, [store]);

  return <>{children}</>;
}

/**
 * Read `userId`/`orgId` claims from the JWT without verifying the signature
 * — the cookie was already validated by the server when it set the cookie.
 * Returns null on any decode failure so the caller can skip session-scoped
 * features rather than crash.
 */
function decodeSessionFromToken(token: string): { orgId: string; userId: string } | null {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) {
      return null;
    }
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { orgId?: string; userId?: string };
    if (!payload.orgId || !payload.userId) {
      return null;
    }
    return { orgId: payload.orgId, userId: payload.userId };
  } catch {
    return null;
  }
}
