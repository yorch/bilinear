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
 * Reads the session via `/api/auth/ws-ticket`, which validates the
 * httpOnly access cookie server-side and returns a short-lived ticket
 * scoped to the WebSocket endpoint plus the resolved `{ userId, orgId }`.
 * The long-lived access token never leaves the cookie jar.
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
      const res = await fetch('/api/auth/ws-ticket', {
        credentials: 'include',
        method: 'GET',
      });
      if (!res.ok || cancelled) {
        return;
      }

      const data = (await res.json()) as {
        ticket?: string;
        userId?: string;
        orgId?: string;
      };
      if (!data.ticket || !data.userId || !data.orgId || cancelled) {
        return;
      }

      const session = { orgId: data.orgId, userId: data.userId };

      // Scope the TransactionQueue to this user/org so a sign-out + sign-in
      // on the same browser can't replay the previous user's pending
      // mutations under the new user's auth cookies.
      TransactionQueue.setActiveSession(session);

      // Wire the current user into the UserStore so components using
      // `userStore.currentUser` (mention defaults, "is mine?" checks,
      // subscribed indicator, owner-only UI) resolve correctly.
      store.userStore.setCurrentUserId(session.userId);

      const wsClient = new WsClient();
      const syncManager = new SyncManager(store, wsClient);
      localManager = syncManager;
      syncManagerRef.current = syncManager;

      await syncManager.start(session.orgId);

      // Replay queued mutations from a previous session. Run after
      // bootstrap/delta sync so reconciliation has the latest server
      // state — an already-accepted mutation becomes a no-op retry or
      // surfaces a permanent error and drops the row.
      void TransactionQueue.hydrate(session);
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
