'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import {
  deleteTenant,
  fetchTenants,
  type PlatformTenant,
  restoreTenant,
  suspendTenant,
} from '@/lib/admin-api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

type TenantStatus = 'active' | 'suspended' | 'archived';

function statusOf(t: PlatformTenant): TenantStatus {
  if (t.archivedAt) {
    return 'archived';
  }
  if (t.suspendedAt) {
    return 'suspended';
  }
  return 'active';
}

const STATUS_STYLES: Record<TenantStatus, string> = {
  active: 'bg-success-subtle text-success-subtle-foreground',
  archived: 'bg-muted text-muted-foreground',
  suspended: 'bg-warning-subtle text-warning-subtle-foreground',
};

function TenantsInner() {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [applied, setApplied] = useState(searchParams.get('q') ?? '');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<PlatformTenant | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTenants(applied, includeArchived)
      .then(setTenants)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [applied, includeArchived]);

  useEffect(() => {
    load();
  }, [load]);

  function replaceRow(updated: PlatformTenant) {
    setTenants(prev => prev.map(t => (t.id === updated.id ? updated : t)));
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSuspend(tenant: PlatformTenant) {
    const reason = window.prompt(t('admin.tenants.suspendPrompt', { name: tenant.name }), '');
    if (reason === null) {
      return;
    }
    await withBusy(tenant.id, async () => {
      replaceRow(await suspendTenant(tenant.id, reason.trim() || null));
      toast.success(t('admin.tenants.suspendedToast', { name: tenant.name }));
    });
  }

  async function handleRestore(tenant: PlatformTenant) {
    await withBusy(tenant.id, async () => {
      replaceRow(await restoreTenant(tenant.id));
      toast.success(t('admin.tenants.restoredToast', { name: tenant.name }));
    });
  }

  async function handleDelete(tenant: PlatformTenant) {
    await withBusy(tenant.id, async () => {
      const updated = await deleteTenant(tenant.id);
      if (includeArchived) {
        replaceRow(updated);
      } else {
        setTenants(prev => prev.filter(x => x.id !== tenant.id));
      }
      toast.success(t('admin.tenants.archivedToast', { name: tenant.name }));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t('admin.tenants.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('admin.tenants.subtitle')}</p>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => {
          e.preventDefault();
          setApplied(query);
        }}
      >
        <input
          className="rounded border border-input bg-transparent px-2 py-1 text-sm focus:border-ring focus:outline-none focus:shadow-[0_0_0_3px_var(--brand-subtle)]"
          onChange={e => setQuery(e.target.value)}
          placeholder={t('admin.tenants.searchPlaceholder')}
          value={query}
        />
        <button
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          type="submit"
        >
          {t('common.search')}
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            checked={includeArchived}
            onChange={e => setIncludeArchived(e.target.checked)}
            type="checkbox"
          />
          {t('admin.tenants.includeArchived')}
        </label>
      </form>

      {loading ? (
        <RowsSkeleton count={5} />
      ) : error ? (
        <p className="text-sm text-danger-subtle-foreground">{error}</p>
      ) : tenants.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('admin.tenants.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-2">{t('admin.tenants.colOrganization')}</th>
                <th className="px-4 py-2">{t('admin.tenants.colStatus')}</th>
                <th className="px-4 py-2 text-right">{t('admin.tenants.colMembers')}</th>
                <th className="px-4 py-2 text-right">{t('admin.tenants.colIssues')}</th>
                <th className="px-4 py-2">{t('admin.tenants.colCreated')}</th>
                <th className="px-4 py-2 text-right">{t('admin.tenants.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map(tenant => {
                const status = statusOf(tenant);
                return (
                  <tr className="bg-background" key={tenant.id}>
                    <td className="px-4 py-2">
                      <Link
                        className="font-medium text-brand hover:underline"
                        href={`/admin/tenants/${tenant.id}`}
                      >
                        {tenant.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {tenant.urlKey} · {tenant.dataRegion}
                      </p>
                      {tenant.suspendedReason ? (
                        <p className="mt-0.5 text-xs text-warning-subtle-foreground">
                          {tenant.suspendedReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs font-medium capitalize',
                          STATUS_STYLES[status],
                        )}
                      >
                        {t(`admin.tenants.status.${status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {tenant.memberCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {tenant.issueCount}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDate(tenant.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">
                        {status === 'suspended' ? (
                          <button
                            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                            disabled={busyId === tenant.id}
                            onClick={() => handleRestore(tenant)}
                            type="button"
                          >
                            {t('admin.tenants.restore')}
                          </button>
                        ) : status === 'active' ? (
                          <button
                            className="rounded border border-warning/40 px-2 py-1 text-xs text-warning-subtle-foreground hover:bg-warning-subtle disabled:opacity-50"
                            disabled={busyId === tenant.id}
                            onClick={() => handleSuspend(tenant)}
                            type="button"
                          >
                            {t('admin.tenants.suspend')}
                          </button>
                        ) : null}
                        {status !== 'archived' && (
                          <button
                            className="rounded border border-danger/40 px-2 py-1 text-xs text-danger-subtle-foreground hover:bg-danger-subtle disabled:opacity-50"
                            disabled={busyId === tenant.id}
                            onClick={() => setConfirmingDelete(tenant)}
                            type="button"
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        message={t('admin.tenants.deleteConfirm', { name: confirmingDelete?.name ?? '' })}
        onCancel={() => setConfirmingDelete(null)}
        onConfirm={() => {
          if (confirmingDelete) {
            void handleDelete(confirmingDelete);
          }
          setConfirmingDelete(null);
        }}
        open={confirmingDelete !== null}
        title={t('common.delete')}
      />
    </div>
  );
}

export default function AdminTenantsPage() {
  return (
    <Suspense fallback={<RowsSkeleton count={5} />}>
      <TenantsInner />
    </Suspense>
  );
}
