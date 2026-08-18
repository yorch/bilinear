'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
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

/**
 * The org to impersonate into when it is unambiguous. A user in several orgs
 * returns null and is routed to the picker dialog instead — this used to be a
 * `window.prompt` asking the operator to type a list index, where a mistyped
 * digit silently impersonated into the wrong tenant.
 */
function soleOrg(user: PlatformUser): PlatformUser['organizations'][number] | null {
  return user.organizations.length === 1 ? user.organizations[0] : null;
}

export default function AdminUsersPage() {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<PlatformUser | null>(null);
  const [pickingOrgFor, setPickingOrgFor] = useState<PlatformUser | null>(null);

  const {
    data: users,
    setData: setUsers,
    loading,
    error,
    errorMessage,
    refetch: load,
  } = useRetryableFetch<PlatformUser[]>(() => fetchUsers(applied), [applied], []);

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
    if (u.organizations.length === 0) {
      toast.error(t('admin.users.noOrgToImpersonate'));
      return;
    }
    const org = soleOrg(u);
    if (!org) {
      setPickingOrgFor(u);
      return;
    }
    await impersonateInto(u, org.id);
  }

  async function impersonateInto(u: PlatformUser, orgId: string) {
    setPickingOrgFor(null);
    await withBusy(u.id, async () => {
      const urlKey = await startImpersonation(u.id, orgId);
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
          className="rounded border border-input bg-transparent px-2 py-1 text-sm focus:border-ring focus:outline-none focus:shadow-[0_0_0_3px_var(--brand-subtle)]"
          onChange={e => setQuery(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder')}
          value={query}
        />
        <button
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          type="submit"
        >
          {t('common.search')}
        </button>
      </form>

      {loading ? (
        <RowsSkeleton count={5} />
      ) : error ? (
        <InlineRetry
          message={errorMessage ?? t('common.somethingWentWrong')}
          onRetry={() => load()}
        />
      ) : users.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('admin.users.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-2">{t('admin.users.colUser')}</th>
                <th className="px-4 py-2">{t('admin.users.colOrganizations')}</th>
                <th className="px-4 py-2">{t('admin.users.colStatus')}</th>
                <th className="px-4 py-2 text-right">{t('admin.users.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr className="bg-background" key={u.id}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{u.displayName}</p>
                      {u.isPlatformAdmin && (
                        <span className="rounded bg-brand-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-subtle-foreground dark:text-brand">
                          {t('admin.users.adminBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-4 py-2">
                    {u.organizations.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.organizations.map(o => (
                          <span
                            className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
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
                          ? 'bg-success-subtle text-success-subtle-foreground'
                          : 'bg-danger-subtle text-danger-subtle-foreground',
                      )}
                    >
                      {u.active ? t('admin.users.statusActive') : t('admin.users.statusSuspended')}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
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
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
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
                            ? 'border-warning/40 text-warning-subtle-foreground hover:bg-warning-subtle'
                            : 'border-success/40 text-success-subtle-foreground hover:bg-success-subtle',
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
      <ModalDialog
        aria-label={t('admin.users.pickOrgPrompt', {
          name: pickingOrgFor?.displayName ?? '',
        })}
        onClose={() => setPickingOrgFor(null)}
        open={pickingOrgFor !== null}
      >
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t('admin.users.pickOrgPrompt', { name: pickingOrgFor?.displayName ?? '' })}
          </h2>
          <ul className="mt-3 flex flex-col gap-1">
            {pickingOrgFor?.organizations.map(o => (
              <li key={o.id}>
                <button
                  className="flex w-full items-center justify-between gap-3 rounded border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    if (pickingOrgFor) {
                      void impersonateInto(pickingOrgFor, o.id);
                    }
                  }}
                  type="button"
                >
                  <span className="text-foreground">{o.name}</span>
                  <span className="text-xs text-muted-foreground">{o.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={() => setPickingOrgFor(null)} size="sm" type="button" variant="ghost">
            {t('common.cancel')}
          </Button>
        </div>
      </ModalDialog>
    </div>
  );
}
