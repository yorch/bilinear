'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchUsers,
  type PlatformUser,
  reactivateUser,
  setUserAdmin,
  startImpersonation,
  suspendUser,
} from '@/lib/admin-api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** Choose which org to impersonate into when a user belongs to several. */
function pickOrg(user: PlatformUser): PlatformUser['organizations'][number] | null {
  if (user.organizations.length === 0) {
    return null;
  }
  if (user.organizations.length === 1) {
    return user.organizations[0];
  }
  const list = user.organizations.map((o, i) => `${i + 1}. ${o.name} (${o.role})`).join('\n');
  const choice = window.prompt(`Impersonate ${user.displayName} in which org?\n${list}`, '1');
  if (choice === null) {
    return null;
  }
  const idx = Number.parseInt(choice, 10) - 1;
  return user.organizations[idx] ?? null;
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchUsers(applied)
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  function replaceRow(updated: PlatformUser) {
    setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
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

  async function handleToggleActive(u: PlatformUser) {
    await withBusy(u.id, async () => {
      replaceRow(u.active ? await suspendUser(u.id) : await reactivateUser(u.id));
      toast.success(u.active ? `Suspended ${u.displayName}` : `Reactivated ${u.displayName}`);
    });
  }

  async function handleToggleAdmin(u: PlatformUser) {
    if (u.isPlatformAdmin && !window.confirm(`Revoke platform-admin from ${u.displayName}?`)) {
      return;
    }
    await withBusy(u.id, async () => {
      replaceRow(await setUserAdmin(u.id, !u.isPlatformAdmin));
      toast.success(u.isPlatformAdmin ? 'Platform admin revoked' : 'Platform admin granted');
    });
  }

  async function handleImpersonate(u: PlatformUser) {
    const org = pickOrg(u);
    if (!org) {
      if (u.organizations.length > 0) {
        return;
      }
      toast.error('User has no organization to impersonate into');
      return;
    }
    await withBusy(u.id, async () => {
      const urlKey = await startImpersonation(u.id, org.id);
      // Full navigation so the new impersonation cookie is picked up everywhere.
      window.location.href = `/${urlKey}`;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Users</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Every account across all organizations. Suspend to block sign-in globally.
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
          placeholder="Search name or email"
          value={query}
        />
        <button
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
          type="submit"
        >
          Search
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : users.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          No users found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Organizations</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map(u => (
                <tr className="bg-white dark:bg-zinc-950" key={u.id}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {u.displayName}
                      </p>
                      {u.isPlatformAdmin && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-2">
                    {u.organizations.length === 0 ? (
                      <span className="text-xs text-zinc-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.organizations.map(o => (
                          <span
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            key={o.id}
                            title={`${o.role} · ${o.urlKey}`}
                          >
                            {o.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium',
                        u.active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
                      )}
                    >
                      {u.active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        disabled={busyId === u.id || u.organizations.length === 0 || !u.active}
                        onClick={() => handleImpersonate(u)}
                        title={
                          u.organizations.length === 0
                            ? 'No organization to impersonate into'
                            : 'Sign in as this user'
                        }
                        type="button"
                      >
                        Impersonate
                      </button>
                      <button
                        className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        disabled={busyId === u.id}
                        onClick={() => handleToggleAdmin(u)}
                        type="button"
                      >
                        {u.isPlatformAdmin ? 'Revoke admin' : 'Make admin'}
                      </button>
                      <button
                        className={cn(
                          'rounded border px-2 py-1 text-xs disabled:opacity-50',
                          u.active
                            ? 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950'
                            : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950',
                        )}
                        disabled={busyId === u.id}
                        onClick={() => handleToggleActive(u)}
                        type="button"
                      >
                        {u.active ? 'Suspend' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
