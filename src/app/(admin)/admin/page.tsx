'use client';

import Link from 'next/link';
import { InlineRetry } from '@/components/shared/inline-retry';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { fetchMetrics, type PlatformMetrics } from '@/lib/admin-api';
import { getErrorMessage } from '@/lib/utils';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  const t = useTranslations();
  useDocumentTitle(t('admin.nav.dashboard'));
  const {
    data: metrics,
    loading,
    error,
    cause,
    refetch,
  } = useRetryableFetch<PlatformMetrics | null>(fetchMetrics, [], null);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('admin.dashboard.loading')}</p>;
  }
  if (error || !metrics) {
    return (
      <InlineRetry
        message={getErrorMessage(cause, t('admin.dashboard.loadError'))}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t('admin.dashboard.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('admin.dashboard.subtitle')}</p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('admin.dashboard.organizations')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('admin.dashboard.total')} value={metrics.totalOrgs} />
          <StatCard label={t('admin.dashboard.active')} value={metrics.activeOrgs} />
          <StatCard label={t('admin.dashboard.suspended')} value={metrics.suspendedOrgs} />
          <StatCard
            label={t('admin.dashboard.new30d')}
            sub={t('admin.dashboard.inLast7d', { count: metrics.newOrgs7d })}
            value={metrics.newOrgs30d}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('admin.dashboard.users')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('admin.dashboard.total')} value={metrics.totalUsers} />
          <StatCard label={t('admin.dashboard.active')} value={metrics.activeUsers} />
          <StatCard label={t('admin.dashboard.suspended')} value={metrics.suspendedUsers} />
          <StatCard label={t('admin.dashboard.platformAdmins')} value={metrics.platformAdmins} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t('admin.dashboard.newUsers30d')}
            sub={t('admin.dashboard.inLast7d', { count: metrics.newUsers7d })}
            value={metrics.newUsers30d}
          />
          <StatCard label={t('admin.dashboard.totalIssues')} value={metrics.totalIssues} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('admin.dashboard.mostActiveOrgs')}
        </h2>
        {metrics.topOrgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.dashboard.noOrgs')}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-2">{t('admin.dashboard.colOrganization')}</th>
                  <th className="px-4 py-2 text-right">{t('admin.dashboard.colMembers')}</th>
                  <th className="px-4 py-2 text-right">{t('admin.dashboard.colIssues')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {metrics.topOrgs.map(o => (
                  <tr className="bg-background" key={o.id}>
                    <td className="px-4 py-2">
                      <Link
                        className="font-medium text-brand hover:underline"
                        href={`/admin/tenants?q=${encodeURIComponent(o.urlKey)}`}
                      >
                        {o.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {o.urlKey}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {o.memberCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {o.issueCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
