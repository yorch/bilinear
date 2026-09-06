'use client';

import { useState } from 'react';
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
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';

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
        createdAt
      }
      hasMore
      nextCursor
    }
  }
`;

const AUDIT_ACTIONS = [
  'api_key.created',
  'api_key.revoked',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'issue.archived',
  'issue.bulk_updated',
  'issue.created',
  'issue.deleted',
  'member.invited',
  'member.removed',
  'member.role_changed',
  'project.created',
  'project.deleted',
  'saml.configured',
  'saml.disabled',
  'saml.enabled',
  'scim.token_created',
  'scim.token_revoked',
  'settings.security_changed',
  'team.created',
  'team.deleted',
  'webhook.created',
  'webhook.deleted',
] as const;

export default function AuditLogPage() {
  const t = useTranslations();
  useDocumentTitle(t('settings.auditLog.title'));
  const { formatDateTime } = useFormatters();
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedUserId, setAppliedUserId] = useState('');

  const {
    data: page,
    setData: setPage,
    loading,
    error,
    cause,
    refetch: load,
  } = useRetryableFetch<AuditLogPage>(
    async () => {
      const filter: Record<string, unknown> = {};
      if (appliedAction) {
        filter.action = appliedAction;
      }
      if (appliedUserId) {
        filter.userId = appliedUserId;
      }
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
    [appliedAction, appliedUserId],
    { entries: [], hasMore: false, nextCursor: null },
  );

  const { entries, hasMore, nextCursor } = page;

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    const filter: Record<string, unknown> = { cursor: nextCursor };
    if (appliedAction) {
      filter.action = appliedAction;
    }
    if (appliedUserId) {
      filter.userId = appliedUserId;
    }
    try {
      const next = await gqlQuery<AuditLogPage | null>(AUDIT_LOGS_QUERY, { filter }, 'auditLogs');
      if (next) {
        setPage(prev => ({
          entries: [...prev.entries, ...next.entries],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        }));
      }
    } catch (err) {
      // Previously swallowed: "Load more" simply did nothing on failure.
      toast.error(getErrorMessage(err, t('common.somethingWentWrong')));
    } finally {
      setLoadingMore(false);
    }
  }

  function handleApplyFilters() {
    setAppliedAction(actionFilter);
    setAppliedUserId(userIdFilter);
  }

  function handleClearFilters() {
    setActionFilter('');
    setUserIdFilter('');
    setAppliedAction('');
    setAppliedUserId('');
  }

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
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-2">
          <SimpleSelect
            ariaLabel={t('settings.auditLog.columnAction')}
            className="w-48"
            onChange={setActionFilter}
            options={[
              { label: t('settings.auditLog.allActions'), value: '' },
              ...AUDIT_ACTIONS.map(a => ({ label: a, value: a })),
            ]}
            value={actionFilter}
          />
          <Input
            className="w-56"
            onChange={e => setUserIdFilter(e.target.value)}
            placeholder={t('settings.auditLog.filterByUserId')}
            value={userIdFilter}
          />
          <Button onClick={handleApplyFilters} size="sm" type="button">
            {t('settings.auditLog.apply')}
          </Button>
          {(appliedAction || appliedUserId) && (
            <Button onClick={handleClearFilters} size="sm" type="button" variant="outline">
              {t('settings.auditLog.clear')}
            </Button>
          )}
        </div>

        {loading ? (
          <RowsSkeleton className="p-6" count={6} />
        ) : entries.length === 0 ? (
          <EmptyState size="compact" title={t('settings.auditLog.noEntriesFound')} />
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-sm">
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
                {entries.map(entry => (
                  <tr className="bg-background hover:bg-muted" key={entry.id}>
                    <td className="px-4 py-2">
                      <Badge
                        className="font-mono text-foreground-secondary"
                        tone="muted"
                        variant="square"
                      >
                        {entry.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {entry.user ? (
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {entry.user.displayName}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{entry.user.email}</p>
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
                            <span className="ml-1 font-mono text-muted-foreground">
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
                    <td className="px-4 py-2">
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
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="mt-4 flex justify-center">
            <Button
              disabled={loadingMore}
              onClick={handleLoadMore}
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
}
