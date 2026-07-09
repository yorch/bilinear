'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import {
  deleteTenant,
  fetchTenant,
  type PlatformTenant,
  type PlatformTenantDetail,
  restoreTenant,
  startImpersonation,
  suspendTenant,
} from '@/lib/admin-api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

type TenantStatus = 'active' | 'suspended' | 'archived';

function statusOf(t: { archivedAt: string | null; suspendedAt: string | null }): TenantStatus {
  if (t.archivedAt) {
    return 'archived';
  }
  if (t.suspendedAt) {
    return 'suspended';
  }
  return 'active';
}

const STATUS_STYLES: Record<TenantStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  archived: 'bg-muted text-muted-foreground',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export default function AdminTenantDetailPage() {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tenant, setTenant] = useState<PlatformTenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTenant(id)
      .then(result => {
        if (!result) {
          setError(t('admin.tenants.notFound'));
        } else {
          setTenant(result);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Merge the base fields a mutation returns back into the detail record so the
  // status badge/reason update without a second round trip.
  function mergeBase(updated: PlatformTenant) {
    setTenant(prev => (prev ? { ...prev, ...updated } : prev));
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSuspend() {
    if (!tenant) {
      return;
    }
    const reason = window.prompt(t('admin.tenants.suspendPrompt', { name: tenant.name }), '');
    if (reason === null) {
      return;
    }
    await withBusy(async () => {
      mergeBase(await suspendTenant(tenant.id, reason.trim() || null));
      toast.success(t('admin.tenants.suspendedToast', { name: tenant.name }));
    });
  }

  async function handleRestore() {
    if (!tenant) {
      return;
    }
    await withBusy(async () => {
      mergeBase(await restoreTenant(tenant.id));
      toast.success(t('admin.tenants.restoredToast', { name: tenant.name }));
    });
  }

  async function handleDelete() {
    if (!tenant) {
      return;
    }
    setConfirmingDelete(false);
    await withBusy(async () => {
      await deleteTenant(tenant.id);
      toast.success(t('admin.tenants.archivedToast', { name: tenant.name }));
      router.push('/admin/tenants');
    });
  }

  async function handleImpersonateOwner(ownerId: string) {
    if (!tenant) {
      return;
    }
    await withBusy(async () => {
      const urlKey = await startImpersonation(ownerId, tenant.id);
      window.location.href = `/${urlKey}`;
    });
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('admin.tenants.loadingDetail')}</p>;
  }
  if (error || !tenant) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-red-500">{error ?? t('admin.tenants.notFound')}</p>
        <Link
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          href="/admin/tenants"
        >
          {t('admin.tenants.backToTenants')}
        </Link>
      </div>
    );
  }

  const status = statusOf(tenant);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link className="text-xs text-muted-foreground hover:text-foreground" href="/admin/tenants">
          {t('admin.tenants.backBreadcrumb')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">{tenant.name}</h1>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium capitalize',
              STATUS_STYLES[status],
            )}
          >
            {t(`admin.tenants.status.${status}`)}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {tenant.urlKey} · {tenant.dataRegion} · {t('admin.tenants.createdPrefix')}{' '}
            {formatDate(tenant.createdAt)}
          </span>
        </div>
        {tenant.suspendedReason ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {t('admin.tenants.suspendedReasonLabel', { reason: tenant.suspendedReason })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {status === 'suspended' ? (
          <button
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={handleRestore}
            type="button"
          >
            {t('admin.tenants.restore')}
          </button>
        ) : status === 'active' ? (
          <button
            className="rounded border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
            disabled={busy}
            onClick={handleSuspend}
            type="button"
          >
            {t('admin.tenants.suspend')}
          </button>
        ) : null}
        {status !== 'archived' && (
          <button
            className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            type="button"
          >
            {t('common.delete')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('admin.tenants.statMembers')} value={tenant.memberCount} />
        <Stat label={t('admin.tenants.statIssues')} value={tenant.issueCount} />
        <Stat label={t('admin.tenants.statTeams')} value={tenant.teamCount} />
        <Stat label={t('admin.tenants.statProjects')} value={tenant.projectCount} />
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('admin.tenants.owners')}
        </h2>
        {tenant.owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.tenants.noOwners')}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {tenant.owners.map(o => (
                  <tr className="bg-background" key={o.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-foreground">{o.displayName}</p>
                      <p className="text-xs text-muted-foreground">{o.email}</p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                        disabled={busy || status !== 'active'}
                        onClick={() => handleImpersonateOwner(o.id)}
                        title={
                          status === 'active'
                            ? t('admin.tenants.impersonateOwnerActive')
                            : t('admin.tenants.impersonateOwnerInactive')
                        }
                        type="button"
                      >
                        {t('admin.tenants.impersonate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ConfirmDialog
        message={t('admin.tenants.deleteConfirmDetail', { name: tenant.name })}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        open={confirmingDelete}
        title={t('common.delete')}
      />
    </div>
  );
}
