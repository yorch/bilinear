'use client';

import { useEffect, useState } from 'react';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { fetchAuditLog, type PlatformAuditEntry } from '@/lib/admin-api';

export default function AdminAuditPage() {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
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
        <h1 className="text-lg font-semibold text-foreground">{t('admin.audit.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('admin.audit.subtitle')}</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('admin.audit.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-2">{t('admin.audit.colAction')}</th>
                <th className="px-4 py-2">{t('admin.audit.colAdmin')}</th>
                <th className="px-4 py-2">{t('admin.audit.colTarget')}</th>
                <th className="px-4 py-2">{t('admin.audit.colWhen')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map(entry => (
                <tr className="bg-white dark:bg-zinc-950" key={entry.id}>
                  <td className="px-4 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {entry.actor ? (
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          {entry.actor.displayName}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{entry.actor.email}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.targetType ? (
                      <span className="text-xs text-muted-foreground">
                        {entry.targetType}
                        {entry.targetId ? (
                          <span className="ml-1 font-mono text-muted-foreground">
                            {entry.targetId.slice(0, 8)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
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
            className="rounded border border-border px-4 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            disabled={loadingMore}
            onClick={handleLoadMore}
            type="button"
          >
            {loadingMore ? t('common.loading') : t('admin.audit.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
