'use client';

import { UserMinus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormatters } from '@/hooks/use-formatters';
import { pendingWriteCount, useOrganizationLeave } from '@/hooks/use-organization-switch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import {
  ORGANIZATION_INVITE_CREATE_MUTATION,
  ORGANIZATION_INVITE_REVOKE_MUTATION,
  ORGANIZATION_INVITES_QUERY,
  ORGANIZATION_MEMBER_REMOVE_MUTATION,
  UPDATE_ORG_MEMBER_ROLE_MUTATION,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const ORG_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_BADGES: Record<OrgRole, { labelKey: string; cls: string }> = {
  admin: {
    cls: 'bg-info-subtle text-info-subtle-foreground',
    labelKey: 'settings.roles.admin',
  },
  guest: {
    cls: 'bg-muted text-muted-foreground',
    labelKey: 'settings.roles.guest',
  },
  member: {
    cls: 'bg-muted text-muted-foreground',
    labelKey: 'settings.roles.member',
  },
  owner: {
    cls: 'bg-brand-subtle text-brand-subtle-foreground',
    labelKey: 'settings.roles.owner',
  },
};

interface PendingInvite {
  email: string;
  expiresAt: string;
  id: string;
  role: string;
}

interface RemovalTarget {
  name: string;
  userId: string;
}

interface MembersSectionProps {
  /** The current workspace's name, for the leave confirmation copy. */
  orgName: string;
}

/**
 * Workspace members: the roster with role editing, removal, pending
 * invitations, and the viewer's own "leave workspace" action.
 *
 * Owns its own data rather than taking it from the settings page, because
 * all three roster operations mutate the same two lists (a member removed
 * leaves the roster, an invitation accepted joins it) and threading that back
 * through the page's state would put the reconciliation logic a long way
 * from the mutations that cause it. Leaving lives here for the same reason —
 * whether it may be offered at all depends on the owner count in that roster.
 */
export const MembersSection = observer(function MembersSection({ orgName }: MembersSectionProps) {
  const { organizationMemberStore, userStore } = useStore();
  const t = useTranslations();
  const { formatDate } = useFormatters();

  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<RemovalTarget | null>(null);

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviting, setInviting] = useState(false);
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);

  // The roster comes from the sync pipeline, not a query of its own.
  //
  // It used to be fetched here and reconciled locally after each mutation,
  // which is why `organizationMemberRemove` and `organizationMemberUpdateRole`
  // emitted SyncActions that no client handled: a second admin's open tab kept
  // showing someone who had been removed until they reloaded. Bootstrap now
  // ships `organizationMembers` and `SyncManager` applies the live actions, so
  // every open tab converges — and the local reconciliation, its rollback
  // branch, and the load/retry state all disappear with it. A failed bootstrap
  // is already surfaced app-wide by `SyncErrorState`.
  const memberRoles = organizationMemberStore.rolesByUserId as Record<string, OrgRole>;

  const currentUserId = userStore.currentUser?.id ?? null;
  const viewerRole = currentUserId ? memberRoles[currentUserId] : undefined;
  const isOwner = viewerRole === 'owner';
  // Derived from the viewer's actual role rather than from whether an
  // admin-only query happened to succeed: a network failure on the invites
  // request must not silently strip an owner of their management controls.
  const canManage = viewerRole === 'owner' || viewerRole === 'admin';
  // The server refuses to let the last owner leave, so the UI doesn't offer
  // it — mirroring the guard rather than discovering it from a rejection.
  const isLastOwner = isOwner && organizationMemberStore.countByRole('owner') === 1;

  const [confirmingLeave, setConfirmingLeave] = useState<{ pendingWrites: number } | null>(null);
  const { leave, leaving } = useOrganizationLeave();

  async function leaveWorkspace() {
    try {
      await leave();
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.leaveError')));
    }
  }

  // Owner/admin-only, so it waits until the roster says the viewer can
  // manage — asking earlier would collect a guaranteed FORBIDDEN for
  // ordinary members and make a genuine failure unreadable.
  useEffect(() => {
    if (!canManage) {
      return;
    }
    let cancelled = false;
    gqlQuery<PendingInvite[]>(ORGANIZATION_INVITES_QUERY, {}, 'organizationInvites')
      .then(rows => {
        if (!cancelled) {
          setInvites(rows);
        }
      })
      .catch(() => {
        // Pending invitations stay empty; the roster and its actions are
        // unaffected, and the invite form still works.
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  // Synced users intersected with the roster: a User row can linger in the
  // store after removal (nothing deletes Users), so membership decides who is
  // still in the workspace.
  const members = userStore.all.filter(u => memberRoles[u.id] !== undefined);

  // No optimistic apply and so no rollback: the server's SyncAction is what
  // moves the store, which means a rejected request (an admin attempting to
  // grant owner) simply never changes the displayed role. The previous code
  // wrote the new role locally and had to restore it by hand on failure.
  async function updateMemberRole(userId: string, role: OrgRole) {
    setUpdatingRole(userId);
    try {
      await gqlMutate(UPDATE_ORG_MEMBER_ROLE_MUTATION, { role, userId });
      toast.success(t('settings.workspace.memberRoleUpdated'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.memberRoleUpdateError')));
    } finally {
      setUpdatingRole(null);
    }
  }

  async function removeMember(target: RemovalTarget) {
    setRemoving(target.userId);
    try {
      await gqlMutate(ORGANIZATION_MEMBER_REMOVE_MUTATION, { userId: target.userId });
      toast.success(t('settings.workspace.removeMemberSuccess', { name: target.name }));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.removeMemberFailed')));
    } finally {
      setRemoving(null);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      return;
    }
    setInviting(true);
    try {
      const created = await gqlQuery<{ invite: PendingInvite }>(
        ORGANIZATION_INVITE_CREATE_MUTATION,
        { email, role: inviteRole },
        'organizationInviteCreate',
      ).then(payload => payload.invite);
      setInvites(prev => [created, ...prev.filter(i => i.email !== created.email)]);
      // Cleared only after the server confirmed — see PATTERNS §76.1.
      setInviteEmail('');
      toast.success(t('settings.workspace.inviteSent', { email: created.email }));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.inviteFailed')));
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string) {
    setRevokingInvite(id);
    try {
      await gqlMutate(ORGANIZATION_INVITE_REVOKE_MUTATION, { id });
      setInvites(prev => prev.filter(i => i.id !== id));
      toast.success(t('settings.workspace.inviteRevoked'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.inviteRevokeFailed')));
    } finally {
      setRevokingInvite(null);
    }
  }

  return (
    <>
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('settings.workspace.members')}
          <span className="ml-2 font-normal normal-case text-muted-foreground">
            {members.length}
          </span>
        </h2>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {members.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              {t('settings.workspace.noMembersFound')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {members.map(user => {
                const currentRole = memberRoles[user.id] ?? 'member';
                const roleBadge = ROLE_BADGES[currentRole];
                const isUpdating = updatingRole === user.id;
                // An owner row is only manageable by another owner, and
                // nobody removes themselves here — both mirror the server
                // guards so the UI can't offer an action that will fail.
                const manageable =
                  canManage && user.id !== currentUserId && (isOwner || currentRole !== 'owner');
                return (
                  <li className="flex items-center gap-3 px-5 py-3" key={user.id}>
                    {user.avatarUrl ? (
                      <Image
                        alt={user.displayName}
                        className="h-7 w-7 rounded-full object-cover shrink-0"
                        height={28}
                        src={user.avatarUrl}
                        unoptimized
                        width={28}
                      />
                    ) : (
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: user.avatarBgColor }}
                      >
                        {user.initials}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {user.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    {!user.active && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {t('settings.workspace.inactive')}
                      </span>
                    )}
                    <div className="relative shrink-0">
                      <select
                        className={cn(
                          'appearance-none rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer',
                          'border border-transparent focus:outline-none focus:ring-1 focus:ring-brand',
                          'disabled:opacity-50 disabled:cursor-not-allowed',
                          roleBadge.cls,
                        )}
                        disabled={isUpdating || !manageable}
                        onChange={e => void updateMemberRole(user.id, e.target.value as OrgRole)}
                        value={currentRole}
                      >
                        {ORG_ROLES.map(r => (
                          <option key={r} value={r}>
                            {t(ROLE_BADGES[r].labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {manageable && (
                      <button
                        aria-label={t('settings.workspace.removeMember')}
                        className={cn(
                          'shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50',
                          TOUCH_TARGET,
                        )}
                        disabled={removing === user.id}
                        onClick={() =>
                          setConfirmingRemoval({ name: user.displayName, userId: user.id })
                        }
                        title={t('settings.workspace.removeMember')}
                        type="button"
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {canManage && (
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.inviteMember')}
          </h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            <form className="flex flex-wrap items-center gap-2 px-5 py-4" onSubmit={sendInvite}>
              <Input
                aria-label={t('settings.workspace.inviteMember')}
                className="min-w-0 flex-1"
                onChange={e => setInviteEmail(e.target.value)}
                placeholder={t('settings.workspace.inviteEmailPlaceholder')}
                required
                type="email"
                value={inviteEmail}
              />
              <select
                aria-label={t('settings.roles.member')}
                className="rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                onChange={e => setInviteRole(e.target.value as OrgRole)}
                value={inviteRole}
              >
                {ORG_ROLES.filter(r => r !== 'owner' || isOwner).map(r => (
                  <option key={r} value={r}>
                    {t(ROLE_BADGES[r].labelKey)}
                  </option>
                ))}
              </select>
              <Button disabled={inviting || !inviteEmail.trim()} size="sm" type="submit">
                {inviting
                  ? t('settings.workspace.inviteSending')
                  : t('settings.workspace.inviteSend')}
              </Button>
            </form>

            {invites.length > 0 && (
              <div className="px-5 py-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('settings.workspace.invitePending')}
                </p>
                <ul className="flex flex-col gap-2">
                  {invites.map(invite => (
                    <li className="flex items-center gap-3" key={invite.id}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            ROLE_BADGES[invite.role as OrgRole]?.labelKey ??
                              'settings.roles.member',
                          )}
                          {' · '}
                          {t('settings.workspace.inviteExpires', {
                            date: formatDate(invite.expiresAt),
                          })}
                        </p>
                      </div>
                      <button
                        aria-label={t('settings.workspace.inviteRevoke')}
                        className={cn(
                          'shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50',
                          TOUCH_TARGET,
                        )}
                        disabled={revokingInvite === invite.id}
                        onClick={() => void revokeInvite(invite.id)}
                        title={t('settings.workspace.inviteRevoke')}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/*
        Leaving is the viewer's own action, so it sits apart from the roster
        rather than as a row action — the members list is where you act on
        *other* people, and the server refuses self-removal from there.

        Hidden for the last owner, mirroring the server's guard: an owner with
        no co-owner cannot leave, because that strands the workspace with
        nobody able to manage it. `isLastOwner` reads the roster the section
        already has, so it never offers an action the server will reject.
      */}
      {currentUserId && !isLastOwner && (
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.leaveTitle')}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/40 bg-card px-5 py-4">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t('settings.workspace.leaveDescription')}
            </p>
            <button
              className="shrink-0 rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
              disabled={leaving}
              // The count is read when the dialog opens, not when it is
              // confirmed, so the warning matches what the user was shown.
              onClick={() => setConfirmingLeave({ pendingWrites: pendingWriteCount() })}
              type="button"
            >
              {leaving ? t('settings.workspace.leaving') : t('settings.workspace.leave')}
            </button>
          </div>
        </section>
      )}

      <ConfirmDialog
        confirmLabel={t('settings.workspace.leave')}
        message={
          // Queued offline writes are scoped to the session that enqueued
          // them and are deleted, not replayed, once a different session
          // hydrates the queue (TransactionQueue.hydrate) — the same reason
          // WorkspaceSwitcher warns before a switch. Leaving is worse: the
          // workspace those edits belong to is one the user can no longer
          // reach, so they are unrecoverable rather than merely dropped.
          confirmingLeave && confirmingLeave.pendingWrites > 0
            ? `${t('settings.workspace.leaveConfirm', { name: orgName })} ${t('settings.workspace.leavePendingWritesWarning')}`
            : t('settings.workspace.leaveConfirm', { name: orgName })
        }
        onCancel={() => setConfirmingLeave(null)}
        onConfirm={() => {
          setConfirmingLeave(null);
          void leaveWorkspace();
        }}
        open={confirmingLeave !== null}
        title={t('settings.workspace.leaveConfirmTitle')}
      />

      <ConfirmDialog
        confirmLabel={t('settings.workspace.removeMember')}
        message={t('settings.workspace.removeMemberConfirm', {
          name: confirmingRemoval?.name ?? '',
        })}
        onCancel={() => setConfirmingRemoval(null)}
        onConfirm={() => {
          const target = confirmingRemoval;
          setConfirmingRemoval(null);
          if (target) {
            void removeMember(target);
          }
        }}
        open={confirmingRemoval !== null}
        title={t('settings.workspace.removeMemberConfirmTitle')}
      />
    </>
  );
});
