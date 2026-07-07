'use client';

import { useSyncExternalStore } from 'react';
import { TransactionQueue } from '@/lib/transaction-queue';

/**
 * Whether a single id has an unconfirmed write in flight in the
 * TransactionQueue. Drives the pending-write indicator on issue rows/cards —
 * a subtle "syncing" dot instead of pixel-identical-to-synced rows. Called
 * per-row/per-card (not lifted to a shared `Set` at a common ancestor) so
 * each subscribes to just its own boolean and only re-renders when its own
 * membership changes, not on every queue mutation anywhere in the app.
 */
export function usePending(id: string): boolean {
  return useSyncExternalStore(
    TransactionQueue.subscribe,
    () => TransactionQueue.getPendingIds().has(id),
    () => false,
  );
}
