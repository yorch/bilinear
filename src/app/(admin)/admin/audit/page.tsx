'use client';

import { useEffect, useState } from 'react';
import { fetchAuditLog, type PlatformAuditEntry } from '@/lib/admin-api';

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAuditLog(null)
      .then(page => {
        if (cancelled) {
          return;
        }
        setEntries(page.entries);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchAuditLog(nextCursor);
      setEntries(prev => [...prev, ...page.entries]);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Platform audit log
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Every cross-tenant action taken from the platform console, including impersonation.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          No platform actions recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Admin</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {entries.map(entry => (
                <tr className="bg-white dark:bg-zinc-950" key={entry.id}>
                  <td className="px-4 py-2">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {entry.actor ? (
                      <div>
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {entry.actor.displayName}
                        </p>
                        <p className="text-[10px] text-zinc-400">{entry.actor.email}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.targetType ? (
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">
                        {entry.targetType}
                        {entry.targetId ? (
                          <span className="ml-1 font-mono text-zinc-400">
                            {entry.targetId.slice(0, 8)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            className="rounded border border-zinc-300 px-4 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            disabled={loadingMore}
            onClick={handleLoadMore}
            type="button"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
