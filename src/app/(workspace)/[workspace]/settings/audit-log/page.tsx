'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { INTL_LOCALES } from '@/lib/i18n';
import { useLocale } from '@/providers/locale-provider';

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
  const { locale } = useLocale();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
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

    gql(AUDIT_LOGS_QUERY, { filter: Object.keys(filter).length ? filter : null })
      .then(res => {
        if (cancelled) {
          return;
        }
        if (res.errors?.length) {
          const code = (res.errors[0] as { extensions?: { code?: string } })?.extensions?.code;
          if (code === 'FORBIDDEN') {
            setForbidden(true);
          }
          return;
        }
        const page = (res.data as { auditLogs?: AuditLogPage } | undefined)?.auditLogs;
        if (page) {
          setEntries(page.entries);
          setHasMore(page.hasMore);
          setNextCursor(page.nextCursor);
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
  }, [appliedAction, appliedUserId]);

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
    const res = await gql(AUDIT_LOGS_QUERY, { filter });
    setLoadingMore(false);
    if (!res.errors?.length) {
      const page = (res.data as { auditLogs?: AuditLogPage } | undefined)?.auditLogs;
      if (page) {
        setEntries(prev => [...prev, ...page.entries]);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      }
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

  if (forbidden) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('settings.auditLog.forbidden')}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('settings.auditLog.title')}
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t('settings.auditLog.description')}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
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
          className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          onChange={e => setUserIdFilter(e.target.value)}
          placeholder={t('settings.auditLog.filterByUserId')}
          value={userIdFilter}
        />
        <button
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
          onClick={handleApplyFilters}
          type="button"
        >
          {t('settings.auditLog.apply')}
        </button>
        {(appliedAction || appliedUserId) && (
          <button
            className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            onClick={handleClearFilters}
            type="button"
          >
            {t('settings.auditLog.clear')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16 text-sm text-zinc-400">
          {t('common.loading')}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t('settings.auditLog.noEntriesFound')}
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('settings.auditLog.columnAction')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('settings.auditLog.columnUser')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('settings.auditLog.columnResource')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('settings.auditLog.columnIp')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('settings.auditLog.columnTimestamp')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {entries.map(entry => (
                <tr
                  className="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  key={entry.id}
                >
                  <td className="px-4 py-2">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {entry.user ? (
                      <div>
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {entry.user.displayName}
                        </p>
                        <p className="text-[10px] text-zinc-400">{entry.user.email}</p>
                      </div>
                    ) : entry.userId ? (
                      <span className="font-mono text-xs text-zinc-400">{entry.userId}</span>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">
                        {t('settings.auditLog.system')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.resourceType ? (
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">
                        {entry.resourceType}
                        {entry.resourceId ? (
                          <span className="ml-1 font-mono text-zinc-400">
                            {entry.resourceId.slice(0, 8)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.ipAddress ? (
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {entry.ipAddress}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(entry.createdAt).toLocaleString(INTL_LOCALES[locale], {
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
            className="rounded border border-zinc-300 px-4 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
