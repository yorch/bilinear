'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { PromptDialog } from '@/components/shared/prompt-dialog';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import {
  deleteTenant,
  fetchTenant,
  type PlatformTenant,
  type PlatformTenantDetail,
  restoreTenant,
  startImpersonation,
  suspendTenant,
  updateTenantLimits,
} from '@/lib/admin-api';
import {
  type OrganizationPlanLimits,
  PLAN_LIMIT_FIELDS,
  type PlanLimitKey,
} from '@/lib/plan-limits';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';

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
  active: 'bg-success-subtle text-success-subtle-foreground',
  archived: 'bg-muted text-muted-foreground',
  suspended: 'bg-warning-subtle text-warning-subtle-foreground',
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
  const { formatDate, intlLocale } = useFormatters();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  // null = not editing; otherwise a draft of the five caps as strings (so the
  // inputs stay controlled while mid-edit, including a transient empty value).
  const [limitsDraft, setLimitsDraft] = useState<Record<PlanLimitKey, string> | null>(null);

  // A missing tenant resolves to `null` rather than throwing, which keeps it
  // distinct from a failed request below: "no such tenant" is not retryable,
  // a transport or GraphQL error is.
  const {
    data: tenant,
    setData: setTenant,
    loading,
    error,
    cause,
    refetch: load,
  } = useRetryableFetch<PlatformTenantDetail | null>(() => fetchTenant(id), [id], null);

  useDocumentTitle(tenant?.name);

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

  async function handleSuspendConfirmed(reason: string) {
    setSuspendOpen(false);
    if (!tenant) {
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

  function startEditingLimits() {
    if (!tenant) {
      return;
    }
    const draft = {} as Record<PlanLimitKey, string>;
    for (const { key } of PLAN_LIMIT_FIELDS) {
      draft[key] = String(tenant.limits[key]);
    }
    setLimitsDraft(draft);
  }

  async function handleSaveLimits() {
    if (!tenant || !limitsDraft) {
      return;
    }
    // Parse every field up front; a non-integer or empty value aborts the save
    // with a toast rather than sending NaN to the server.
    const parsed = {} as OrganizationPlanLimits;
    for (const { key } of PLAN_LIMIT_FIELDS) {
      const n = Number(limitsDraft[key]);
      if (!Number.isInteger(n) || n < 1) {
        toast.error(t('admin.tenants.limits.invalid'));
        return;
      }
      parsed[key] = n;
    }
    await withBusy(async () => {
      const updated = await updateTenantLimits(tenant.id, parsed);
      setTenant(updated);
      setLimitsDraft(null);
      toast.success(t('admin.tenants.limits.savedToast', { name: tenant.name }));
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
        {error ? (
          <InlineRetry
            message={getErrorMessage(cause, t('common.somethingWentWrong'))}
            onRetry={() => load()}
          />
        ) : (
          <p className="text-sm text-danger-subtle-foreground">{t('admin.tenants.notFound')}</p>
        )}
        <Link className="text-sm text-brand hover:underline" href="/admin/tenants">
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
          <p className="mt-1 text-xs text-warning-subtle-foreground">
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
            className="rounded border border-warning/40 px-3 py-1.5 text-xs text-warning-subtle-foreground hover:bg-warning-subtle disabled:opacity-50"
            disabled={busy}
            onClick={() => setSuspendOpen(true)}
            type="button"
          >
            {t('admin.tenants.suspend')}
          </button>
        ) : null}
        {status !== 'archived' && (
          <button
            className="rounded border border-danger/40 px-3 py-1.5 text-xs text-danger-subtle-foreground hover:bg-danger-subtle disabled:opacity-50"
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
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('admin.tenants.limits.title')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('admin.tenants.limits.description')}
            </p>
          </div>
          {limitsDraft ? (
            <div className="flex shrink-0 gap-1.5">
              <button
                className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                disabled={busy}
                onClick={() => setLimitsDraft(null)}
                type="button"
              >
                {t('common.cancel')}
              </button>
              <button
                className="rounded border border-brand-border bg-brand-subtle px-3 py-1.5 text-xs text-brand-subtle-foreground hover:bg-brand/15 disabled:opacity-50"
                disabled={busy}
                onClick={handleSaveLimits}
                type="button"
              >
                {t('admin.tenants.limits.save')}
              </button>
            </div>
          ) : (
            <button
              className="shrink-0 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              disabled={busy}
              onClick={startEditingLimits}
              type="button"
            >
              {t('admin.tenants.limits.edit')}
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {PLAN_LIMIT_FIELDS.map(({ key, labelKey }) => (
                <tr className="bg-background" key={key}>
                  <td className="px-4 py-2 text-foreground">{t(`admin.tenants.${labelKey}`)}</td>
                  <td className="px-4 py-2 text-right">
                    {limitsDraft ? (
                      <input
                        className="w-28 rounded border border-input bg-background px-2 py-1 text-right font-mono text-sm tabular-nums focus:border-ring focus:outline-none focus:shadow-[0_0_0_3px_var(--brand-subtle)]"
                        inputMode="numeric"
                        min={1}
                        onChange={e =>
                          setLimitsDraft(prev => (prev ? { ...prev, [key]: e.target.value } : prev))
                        }
                        type="number"
                        value={limitsDraft[key]}
                      />
                    ) : (
                      <span className="font-medium tabular-nums text-foreground">
                        {tenant.limits[key].toLocaleString(intlLocale)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <ConfirmDialog
        message={t('admin.tenants.deleteConfirmDetail', { name: tenant.name })}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        open={confirmingDelete}
        title={t('common.delete')}
      />
      <PromptDialog
        confirmLabel={t('admin.tenants.suspend')}
        label={t('admin.tenants.suspendPrompt', { name: tenant.name })}
        onCancel={() => setSuspendOpen(false)}
        onSubmit={reason => void handleSuspendConfirmed(reason)}
        open={suspendOpen}
        title={t('admin.tenants.suspend')}
      />
    </div>
  );
}
