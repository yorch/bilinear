'use client';

import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { fetchAuditLog, type PlatformAuditEntry } from '@/lib/admin-api';

export default function AdminAuditPage() {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Only the first page goes through useRetryableFetch — it owns the
  // cancelled-flag/stale-response state machine this page used to hand-roll.
  // "Load more" appends through `setEntries` and keeps its own error, since a
  // failed page 3 must not blank the two pages already on screen.
  const {
    data: entries,
    setData: setEntries,
    loading,
    error,
    errorMessage,
    refetch: reload,
  } = useRetryableFetch<PlatformAuditEntry[]>(
    async () => {
      const page = await fetchAuditLog(null);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setPageError(null);
      return page.entries;
    },
    [],
    [],
  );

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
      setPageError(null);
    } catch (e) {
      setPageError((e as Error).message);
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
        <RowsSkeleton count={5} />
      ) : error ? (
        <InlineRetry
          message={errorMessage ?? t('common.somethingWentWrong')}
          onRetry={() => reload()}
        />
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
                <tr className="bg-background" key={entry.id}>
                  <td className="px-4 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground-secondary">
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
                      <span className="text-xs text-foreground-faint">—</span>
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

      {pageError && (
        <InlineRetry className="justify-center" message={pageError} onRetry={handleLoadMore} />
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
