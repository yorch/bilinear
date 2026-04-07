'use client';

import { useEffect, useRef } from 'react';
import { SyncManager } from '@/lib/sync-manager';
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

      const wsClient = new WsClient();
      const syncManager = new SyncManager(store, wsClient);
      syncManagerRef.current = syncManager;

      await syncManager.start(data.token);
    }

    init().catch(err => {
      console.error('[SyncProvider] Init error:', err);
    });

    return () => {
      cancelled = true;
      syncManagerRef.current?.stop();
    };
  }, [store]);

  return <>{children}</>;
}
