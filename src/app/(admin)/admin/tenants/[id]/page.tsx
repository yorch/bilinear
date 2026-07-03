'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
  archived: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tenant, setTenant] = useState<PlatformTenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTenant(id)
      .then(t => {
        if (!t) {
          setError('Tenant not found.');
        } else {
          setTenant(t);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

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
    const reason = window.prompt(`Suspend "${tenant.name}"? Optional reason:`, '');
    if (reason === null) {
      return;
    }
    await withBusy(async () => {
      mergeBase(await suspendTenant(tenant.id, reason.trim() || null));
      toast.success(`Suspended ${tenant.name}`);
    });
  }

  async function handleRestore() {
    if (!tenant) {
      return;
    }
    await withBusy(async () => {
      mergeBase(await restoreTenant(tenant.id));
      toast.success(`Restored ${tenant.name}`);
    });
  }

  async function handleDelete() {
    if (!tenant) {
      return;
    }
    if (
      !window.confirm(
        `Delete (archive) "${tenant.name}"? Members lose access immediately. Data is retained.`,
      )
    ) {
      return;
    }
    await withBusy(async () => {
      await deleteTenant(tenant.id);
      toast.success(`Archived ${tenant.name}`);
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
    return <p className="text-sm text-zinc-400">Loading tenant…</p>;
  }
  if (error || !tenant) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-red-500">{error ?? 'Tenant not found.'}</p>
        <Link
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          href="/admin/tenants"
        >
          ← Back to tenants
        </Link>
      </div>
    );
  }

  const status = statusOf(tenant);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          href="/admin/tenants"
        >
          ← Tenants
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{tenant.name}</h1>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium capitalize',
              STATUS_STYLES[status],
            )}
          >
            {status}
          </span>
          <span className="font-mono text-xs text-zinc-400">
            {tenant.urlKey} · {tenant.dataRegion} · created{' '}
            {new Date(tenant.createdAt).toLocaleDateString()}
          </span>
        </div>
        {tenant.suspendedReason ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Suspended: {tenant.suspendedReason}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {status === 'suspended' ? (
          <button
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            disabled={busy}
            onClick={handleRestore}
            type="button"
          >
            Restore
          </button>
        ) : status === 'active' ? (
          <button
            className="rounded border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
            disabled={busy}
            onClick={handleSuspend}
            type="button"
          >
            Suspend
          </button>
        ) : null}
        {status !== 'archived' && (
          <button
            className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            disabled={busy}
            onClick={handleDelete}
            type="button"
          >
            Delete
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Members" value={tenant.memberCount} />
        <Stat label="Issues" value={tenant.issueCount} />
        <Stat label="Teams" value={tenant.teamCount} />
        <Stat label="Projects" value={tenant.projectCount} />
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Owners</h2>
        {tenant.owners.length === 0 ? (
          <p className="text-sm text-zinc-400">No owners.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {tenant.owners.map(o => (
                  <tr className="bg-white dark:bg-zinc-950" key={o.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {o.displayName}
                      </p>
                      <p className="text-xs text-zinc-400">{o.email}</p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        disabled={busy || status !== 'active'}
                        onClick={() => handleImpersonateOwner(o.id)}
                        title={
                          status === 'active' ? 'Sign in as this owner' : 'Tenant is not active'
                        }
                        type="button"
                      >
                        Impersonate
                      </button>
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
