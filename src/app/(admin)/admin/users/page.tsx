'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useTranslations } from '@/hooks/use-translations';
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
function pickOrg(
  user: PlatformUser,
  t: ReturnType<typeof useTranslations>,
): PlatformUser['organizations'][number] | null {
  if (user.organizations.length === 0) {
    return null;
  }
  if (user.organizations.length === 1) {
    return user.organizations[0];
  }
  const list = user.organizations.map((o, i) => `${i + 1}. ${o.name} (${o.role})`).join('\n');
  const choice = window.prompt(
    `${t('admin.users.pickOrgPrompt', { name: user.displayName })}\n${list}`,
    '1',
  );
  if (choice === null) {
    return null;
  }
  const idx = Number.parseInt(choice, 10) - 1;
  return user.organizations[idx] ?? null;
}

export default function AdminUsersPage() {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<PlatformUser | null>(null);

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
      toast.success(
        u.active
          ? t('admin.users.suspendedToast', { name: u.displayName })
          : t('admin.users.reactivatedToast', { name: u.displayName }),
      );
    });
  }

  async function handleToggleAdmin(u: PlatformUser) {
    await withBusy(u.id, async () => {
      replaceRow(await setUserAdmin(u.id, !u.isPlatformAdmin));
      toast.success(
        u.isPlatformAdmin ? t('admin.users.adminRevokedToast') : t('admin.users.adminGrantedToast'),
      );
    });
  }

  async function handleImpersonate(u: PlatformUser) {
    const org = pickOrg(u, t);
    if (!org) {
      if (u.organizations.length > 0) {
        return;
      }
      toast.error(t('admin.users.noOrgToImpersonate'));
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
        <h1 className="text-lg font-semibold text-foreground">{t('admin.users.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('admin.users.subtitle')}</p>
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
          placeholder={t('admin.users.searchPlaceholder')}
          value={query}
        />
        <button
          className="rounded bg-primary px-3 py-1 text-xs text-white hover:bg-primary/90"
          type="submit"
        >
          {t('common.search')}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-zinc-400">{t('common.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : users.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t('admin.users.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-2">{t('admin.users.colUser')}</th>
                <th className="px-4 py-2">{t('admin.users.colOrganizations')}</th>
                <th className="px-4 py-2">{t('admin.users.colStatus')}</th>
                <th className="px-4 py-2 text-right">{t('admin.users.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr className="bg-white dark:bg-zinc-950" key={u.id}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{u.displayName}</p>
                      {u.isPlatformAdmin && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                          {t('admin.users.adminBadge')}
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
                      {u.active ? t('admin.users.statusActive') : t('admin.users.statusSuspended')}
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
                            ? t('admin.users.impersonateNoOrg')
                            : t('admin.users.impersonateActive')
                        }
                        type="button"
                      >
                        {t('admin.users.impersonate')}
                      </button>
                      <button
                        className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        disabled={busyId === u.id}
                        onClick={() =>
                          u.isPlatformAdmin ? setConfirmingRevoke(u) : void handleToggleAdmin(u)
                        }
                        type="button"
                      >
                        {u.isPlatformAdmin
                          ? t('admin.users.revokeAdmin')
                          : t('admin.users.makeAdmin')}
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
                        {u.active ? t('admin.users.suspend') : t('admin.users.reactivate')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        confirmLabel={t('admin.users.revokeAdmin')}
        message={t('admin.users.revokeAdminConfirm', {
          name: confirmingRevoke?.displayName ?? '',
        })}
        onCancel={() => setConfirmingRevoke(null)}
        onConfirm={() => {
          if (confirmingRevoke) {
            void handleToggleAdmin(confirmingRevoke);
          }
          setConfirmingRevoke(null);
        }}
        open={confirmingRevoke !== null}
        title={t('admin.users.revokeAdmin')}
      />
    </div>
  );
}
