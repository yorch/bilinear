'use client';

import { useRetryableFetch } from '@/hooks/use-retryable-fetch';

/**
 * Load the archived rows of one entity type into its MobX store.
 *
 * Archived rows are deliberately not in the bootstrap payload (it would grow
 * without bound and every list filters them out), so an "Archived" view has to
 * ask for them. The rows land in the store and the component reads them back
 * from there — it never renders the response directly, so a restore (an
 * `archivedAt` patch plus the sync action) moves a row between the two views
 * with no second code path. `enabled` false skips the request entirely.
 */
export function useArchivedLoad<T>(
  enabled: boolean,
  fetchRows: () => Promise<T[]>,
  seed: (rows: T[]) => void,
) {
  const { loading, error, refetch } = useRetryableFetch<T[]>(
    async () => (enabled ? fetchRows() : []),
    [enabled],
    [],
    { onData: rows => rows.length > 0 && seed(rows) },
  );
  return { error: enabled && error, loading: enabled && loading, retry: () => refetch() };
}
