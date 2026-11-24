'use client';

import { ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useState } from 'react';
import {
  AUDIT_ACTIONS,
  auditActionLabel,
  endOfDayIso,
  startOfDayIso,
} from '@/components/settings/audit-action';
import { LoadError } from '@/components/shared/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useLoadMore } from '@/hooks/use-load-more';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { downloadCsv } from '@/lib/csv-export';
import { gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Audit log page (admins only).
 *
 * Displays a paginated list of security-relevant events for the org.
 * Uses cursor-based pagination ordered by createdAt DESC.
 */

interface AuditLogUser {
  displayName: string;
  email: string;
  id: string;
}

interface AuditLogEntry {
  action: string;
  createdAt: string;
  id: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  resourceId: string | null;
  resourceType: string | null;
  user: AuditLogUser | null;
  userId: string | null;
}

interface AuditLogPage {
  entries: AuditLogEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

const AUDIT_EXPORT_QUERY = `
  query AuditLogExport($filter: AuditLogFilter) {
    auditLogExport(filter: $filter) { csv rows truncated }
  }
`;

const AUDIT_LOGS_QUERY = `
  query AuditLogs($filter: AuditLogFilter) {
    auditLogs(filter: $filter) {
      entries {
        id
        action
        userId
        user { id displayName email }
        resourceType
        resourceId
        ipAddress
        metadata
        createdAt
      }
      hasMore
      nextCursor
    }
  }
`;

const AuditLogPage = observer(function AuditLogPage() {
  const t = useTranslations();
  const { organizationMemberStore, userStore } = useStore();
  const memberRoles = organizationMemberStore.rolesByUserId as Record<string, unknown>;
  const memberOptions = userStore.all
    .filter(u => memberRoles[u.id] !== undefined)
    .map(u => ({ label: u.displayName || u.email, value: u.id }));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  useDocumentTitle(t('settings.auditLog.title'));
  const { formatDateTime } = useFormatters();
  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedUserId, setAppliedUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [exporting, setExporting] = useState(false);

  /** The applied filters as the server's `AuditLogFilter`; shared by list, paging and export. */
  function buildFilter(): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (appliedAction) {
      filter.action = appliedAction;
    }
    if (appliedUserId) {
      filter.userId = appliedUserId;
    }
    const from = appliedFrom ? startOfDayIso(appliedFrom) : null;
    const to = appliedTo ? endOfDayIso(appliedTo) : null;
    if (from) {
      filter.from = from;
    }
    if (to) {
      filter.to = to;
    }
    return filter;
  }

  const {
    data: page,
    setData: setPage,
    loading,
    error,
    cause,
    refetch: load,
  } = useRetryableFetch<AuditLogPage>(
    async () => {
      const filter = buildFilter();
      // The cursor travels inside the returned value rather than in its own
      // state. Setting it here would put it outside the hook's monotonic
      // request-id guard: a stale response has its `data` discarded, but would
      // already have overwritten the cursor, so "Load more" would then append
      // rows from the previous filter.
      const first = await gqlQuery<AuditLogPage | null>(
        AUDIT_LOGS_QUERY,
        { filter: Object.keys(filter).length ? filter : null },
        'auditLogs',
      );
      return {
        entries: first?.entries ?? [],
        hasMore: first?.hasMore ?? false,
        nextCursor: first?.nextCursor ?? null,
      };
    },
    [appliedAction, appliedUserId, appliedFrom, appliedTo],
    { entries: [], hasMore: false, nextCursor: null },
  );

  const { entries, hasMore } = page;

  const { loadMore: handleLoadMore, loadingMore } = useLoadMore<AuditLogPage>({
    fetchMore: async cursor => {
      const next = await gqlQuery<AuditLogPage | null>(
        AUDIT_LOGS_QUERY,
        { filter: { ...buildFilter(), cursor } },
        'auditLogs',
      );
      return {
        entries: next?.entries ?? [],
        hasMore: next?.hasMore ?? false,
        nextCursor: next?.nextCursor ?? null,
      };
    },
    merge: (prev, next) => ({
      entries: [...prev.entries, ...next.entries],
      hasMore: next.hasMore,
      nextCursor: next.nextCursor,
    }),
    // Previously swallowed: "Load more" simply did nothing on failure.
    onError: () => toast.error(t('common.somethingWentWrong')),
    page,
    resetKey: JSON.stringify([appliedAction, appliedUserId, appliedFrom, appliedTo]),
    setPage,
  });

  function handleApplyFilters() {
    setAppliedAction(actionFilter);
    setAppliedUserId(userIdFilter);
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
  }

  function handleClearFilters() {
    setActionFilter('');
    setUserIdFilter('');
    setFromDate('');
    setToDate('');
    setAppliedAction('');
    setAppliedUserId('');
    setAppliedFrom('');
    setAppliedTo('');
  }

  async function handleExport() {
    setExporting(true);
    try {
      // The server applies the filter and builds the file, so the export is
      // the whole filtered set rather than the rows loaded so far.
      const filter = buildFilter();
      const out = await gqlQuery<{ csv: string; rows: number; truncated: boolean } | null>(
        AUDIT_EXPORT_QUERY,
        { filter: Object.keys(filter).length ? filter : null },
        'auditLogExport',
      );
      if (!out) {
        throw new Error('empty export');
      }
      downloadCsv('audit-log', out.csv);
      if (out.truncated) {
        toast.warning(t('settings.auditLog.exportTruncated', { rows: out.rows }));
      } else {
        toast.success(t('settings.auditLog.exported', { rows: out.rows }));
      }
    } catch {
      toast.error(t('settings.auditLog.exportError'));
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = Boolean(appliedAction || appliedUserId || appliedFrom || appliedTo);

  // A non-admin's FORBIDDEN is "not for you" — a terminal state with nothing
  // to retry — and `LoadError` tells it apart from a genuine failure by the
  // error's own code. The page chrome stays either way, so a refused read
  // reads as a closed section rather than a crash.
  if (error) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <PageHeader
          description={t('settings.auditLog.description')}
          title={t('settings.auditLog.title')}
        />
        <div className="p-6">
          {/* Deliberately the localized fallback, not the server's raw text:
              this page is workspace-facing, and a raw `Failed to fetch` or
              `GraphQL request failed: 502` reaches a member in whatever language
              the server happened to speak. See REVIEW_BACKLOG §4.3. */}
          <LoadError
            cause={cause}
            fallback={t('common.somethingWentWrong')}
            forbiddenMessage={t('settings.auditLog.forbidden')}
            onRetry={() => load()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('settings.auditLog.description')}
        title={t('settings.auditLog.title')}
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SimpleSelect
            ariaLabel={t('settings.auditLog.columnAction')}
            className="w-full sm:w-48"
            onChange={setActionFilter}
            options={[
              { label: t('settings.auditLog.allActions'), value: '' },
              ...AUDIT_ACTIONS.map(a => ({ label: auditActionLabel(t, a), value: a })),
            ]}
            value={actionFilter}
          />
          <SimpleSelect
            ariaLabel={t('settings.auditLog.columnUser')}
            className="w-full sm:w-56"
            onChange={setUserIdFilter}
            options={[{ label: t('settings.auditLog.allUsers'), value: '' }, ...memberOptions]}
            value={userIdFilter}
          />
          <Input
            aria-label={t('settings.auditLog.dateFrom')}
            className="w-full sm:w-40"
            max={toDate || undefined}
            onChange={e => setFromDate(e.target.value)}
            type="date"
            value={fromDate}
          />
          <Input
            aria-label={t('settings.auditLog.dateTo')}
            className="w-full sm:w-40"
            min={fromDate || undefined}
            onChange={e => setToDate(e.target.value)}
            type="date"
            value={toDate}
          />
          <Button onClick={handleApplyFilters} size="sm" type="button">
            {t('settings.auditLog.apply')}
          </Button>
          {hasFilters && (
            <Button onClick={handleClearFilters} size="sm" type="button" variant="outline">
              {t('settings.auditLog.clear')}
            </Button>
          )}
          <Button
            className="sm:ml-auto"
            disabled={exporting}
            onClick={() => void handleExport()}
            size="sm"
            type="button"
            variant="outline"
          >
            {exporting ? t('settings.auditLog.exporting') : t('settings.auditLog.exportCsv')}
          </Button>
        </div>

        {loading ? (
          <RowsSkeleton className="p-6" count={6} />
        ) : entries.length === 0 ? (
          <EmptyState size="compact" title={t('settings.auditLog.noEntriesFound')} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('settings.auditLog.columnAction')}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('settings.auditLog.columnUser')}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('settings.auditLog.columnResource')}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('settings.auditLog.columnIp')}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('settings.auditLog.columnTimestamp')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map(entry => {
                  const open = expanded.has(entry.id);
                  const meta = entry.metadata && Object.keys(entry.metadata).length > 0;
                  return (
                    <Fragment key={entry.id}>
                      <tr className="bg-background hover:bg-muted">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            {meta ? (
                              <button
                                aria-expanded={open}
                                aria-label={t('settings.auditLog.toggleDetails')}
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                onClick={() => toggleExpanded(entry.id)}
                                type="button"
                              >
                                <ChevronRight
                                  className={cn(
                                    'h-3.5 w-3.5 transition-transform',
                                    open && 'rotate-90',
                                  )}
                                />
                              </button>
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            <Badge
                              className="font-mono text-foreground-secondary"
                              title={entry.action}
                              tone="muted"
                              variant="square"
                            >
                              {auditActionLabel(t, entry.action)}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {entry.user ? (
                            <div>
                              <p className="text-xs font-medium text-foreground">
                                {entry.user.displayName}
                              </p>
                              <p className="text-xs text-muted-foreground">{entry.user.email}</p>
                            </div>
                          ) : entry.userId ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {entry.userId}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t('settings.auditLog.system')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {entry.resourceType ? (
                            <span className="text-xs text-muted-foreground">
                              {entry.resourceType}
                              {entry.resourceId ? (
                                <span
                                  className="ml-1 font-mono text-muted-foreground"
                                  title={entry.resourceId}
                                >
                                  {entry.resourceId.slice(0, 8)}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-xs text-foreground-faint">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {entry.ipAddress ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {entry.ipAddress}
                            </span>
                          ) : (
                            <span className="text-xs text-foreground-faint">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(entry.createdAt, {
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </td>
                      </tr>
                      {open && meta ? (
                        <tr className="bg-muted/40">
                          <td className="px-4 py-2" colSpan={5}>
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground-secondary">
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="mt-4 flex justify-center">
            <Button
              disabled={loadingMore}
              onClick={() => void handleLoadMore()}
              size="sm"
              type="button"
              variant="outline"
            >
              {loadingMore ? t('common.loading') : t('settings.auditLog.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

export default AuditLogPage;
