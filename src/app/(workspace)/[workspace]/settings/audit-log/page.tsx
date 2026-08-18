'use client';

import { useEffect, useState } from 'react';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery, isPermissionError } from '@/lib/graphql';
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
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedUserId, setAppliedUserId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setForbidden(false);

    const filter: Record<string, unknown> = {};
    if (appliedAction) {
      filter.action = appliedAction;
    }
    if (appliedUserId) {
      filter.userId = appliedUserId;
    }

    gqlQuery<AuditLogPage | null>(
      AUDIT_LOGS_QUERY,
      { filter: Object.keys(filter).length ? filter : null },
      'auditLogs',
    )
      .then(page => {
        if (cancelled || !page) {
          return;
        }
        setEntries(page.entries);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        // A non-admin simply can't see the audit log — that's "not for you",
        // not a failure. Anything else is a real error and must not render as
        // an empty log.
        if (isPermissionError(err)) {
          setForbidden(true);
        } else {
          setLoadError(getErrorMessage(err, t('common.somethingWentWrong')));
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
  }, [appliedAction, appliedUserId, t]);

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
      const page = await gqlQuery<AuditLogPage | null>(AUDIT_LOGS_QUERY, { filter }, 'auditLogs');
      if (page) {
        setEntries(prev => [...prev, ...page.entries]);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
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

  if (loadError) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('settings.auditLog.forbidden')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">{t('settings.auditLog.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('settings.auditLog.description')}</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="rounded border border-border bg-transparent px-2 py-1 text-sm"
          onChange={e => setActionFilter(e.target.value)}
          value={actionFilter}
        >
          <option value="">{t('settings.auditLog.allActions')}</option>
          {AUDIT_ACTIONS.map(a => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          className="rounded border border-border bg-transparent px-2 py-1 text-sm"
          onChange={e => setUserIdFilter(e.target.value)}
          placeholder={t('settings.auditLog.filterByUserId')}
          value={userIdFilter}
        />
        <button
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          onClick={handleApplyFilters}
          type="button"
        >
          {t('settings.auditLog.apply')}
        </button>
        {(appliedAction || appliedUserId) && (
          <button
            className="rounded border border-border px-3 py-1 text-xs hover:bg-muted"
            onClick={handleClearFilters}
            type="button"
          >
            {t('settings.auditLog.clear')}
          </button>
        )}
      </div>

      {loading ? (
        <RowsSkeleton className="p-6" count={6} />
      ) : entries.length === 0 ? (
        <div className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('settings.auditLog.noEntriesFound')}
        </div>
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
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground-secondary">
                      {entry.action}
                    </span>
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
          <button
            className="rounded border border-border px-4 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            disabled={loadingMore}
            onClick={handleLoadMore}
            type="button"
          >
            {loadingMore ? t('common.loading') : t('settings.auditLog.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
