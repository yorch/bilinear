'use client';

import { useSyncExternalStore } from 'react';
import { TransactionQueue } from '@/lib/transaction-queue';

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Ids with an unconfirmed optimistic write currently in the TransactionQueue.
 * Drives the pending-write indicator on issue rows/cards — a subtle "syncing"
 * dot instead of pixel-identical-to-synced rows.
 */
export function usePendingIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    TransactionQueue.subscribe,
    TransactionQueue.getPendingIds,
    () => EMPTY_SET,
  );
}
