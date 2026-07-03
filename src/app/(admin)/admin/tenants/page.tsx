'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
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
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  archived: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};

function TenantsInner() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [applied, setApplied] = useState(searchParams.get('q') ?? '');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function handleSuspend(t: PlatformTenant) {
    const reason = window.prompt(`Suspend "${t.name}"? Optional reason:`, '');
    if (reason === null) {
      return;
    }
    await withBusy(t.id, async () => {
      replaceRow(await suspendTenant(t.id, reason.trim() || null));
      toast.success(`Suspended ${t.name}`);
    });
  }

  async function handleRestore(t: PlatformTenant) {
    await withBusy(t.id, async () => {
      replaceRow(await restoreTenant(t.id));
      toast.success(`Restored ${t.name}`);
    });
  }

  async function handleDelete(t: PlatformTenant) {
    if (
      !window.confirm(
        `Delete (archive) "${t.name}"? Members lose access immediately. Data is retained and this can be undone from the database.`,
      )
    ) {
      return;
    }
    await withBusy(t.id, async () => {
      const updated = await deleteTenant(t.id);
      if (includeArchived) {
        replaceRow(updated);
      } else {
        setTenants(prev => prev.filter(x => x.id !== t.id));
      }
      toast.success(`Archived ${t.name}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Tenants</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Every organization in this deployment. Suspend to lock members out without deleting data.
        </p>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => {
          e.preventDefault();
          setApplied(query);
        }}
      >
        <input
          className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name or URL key"
          value={query}
        />
        <button
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
          type="submit"
        >
          Search
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            checked={includeArchived}
            onChange={e => setIncludeArchived(e.target.checked)}
            type="checkbox"
          />
          Include archived
        </label>
      </form>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : tenants.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          No tenants found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-2">Organization</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Members</th>
                <th className="px-4 py-2 text-right">Issues</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tenants.map(t => {
                const status = statusOf(t);
                return (
                  <tr className="bg-white dark:bg-zinc-950" key={t.id}>
                    <td className="px-4 py-2">
                      <Link
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        href={`/admin/tenants/${t.id}`}
                      >
                        {t.name}
                      </Link>
                      <p className="font-mono text-xs text-zinc-400">
                        {t.urlKey} · {t.dataRegion}
                      </p>
                      {t.suspendedReason ? (
                        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                          {t.suspendedReason}
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
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {t.memberCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {t.issueCount}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">
                        {status === 'suspended' ? (
                          <button
                            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            disabled={busyId === t.id}
                            onClick={() => handleRestore(t)}
                            type="button"
                          >
                            Restore
                          </button>
                        ) : status === 'active' ? (
                          <button
                            className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
                            disabled={busyId === t.id}
                            onClick={() => handleSuspend(t)}
                            type="button"
                          >
                            Suspend
                          </button>
                        ) : null}
                        {status !== 'archived' && (
                          <button
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                            disabled={busyId === t.id}
                            onClick={() => handleDelete(t)}
                            type="button"
                          >
                            Delete
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
    </div>
  );
}

export default function AdminTenantsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
      <TenantsInner />
    </Suspense>
  );
}
