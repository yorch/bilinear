'use client';

import { UserMinus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import {
  ORGANIZATION_INVITE_CREATE_MUTATION,
  ORGANIZATION_INVITE_REVOKE_MUTATION,
  ORGANIZATION_INVITES_QUERY,
  ORGANIZATION_MEMBER_REMOVE_MUTATION,
  ORGANIZATION_MEMBERS_QUERY,
  UPDATE_ORG_MEMBER_ROLE_MUTATION,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';
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

/**
 * Workspace members: the roster with role editing, removal, and pending
 * invitations.
 *
 * Owns its own data rather than taking it from the settings page, because
 * all three operations mutate the same two lists (a member removed leaves
 * the roster, an invitation accepted joins it) and threading that back
 * through the page's state would put the reconciliation logic a long way
 * from the mutations that cause it.
 */
export const MembersSection = observer(function MembersSection() {
  const { userStore } = useStore();
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

  // `gqlQuery` throws on a GraphQL error, which is what makes the error
  // branch below reachable at all: a fetcher that swallowed the failure and
  // returned `[]` would render "no members found" for a request the server
  // rejected. See PATTERNS §76.1.
  const {
    data: memberRoles,
    error: rosterError,
    refetch: refetchRoster,
    setData: setMemberRoles,
  } = useRetryableFetch<Record<string, OrgRole>>(
    async () => {
      const rows = await gqlQuery<{ userId: string; role: string }[]>(
        ORGANIZATION_MEMBERS_QUERY,
        {},
        'organizationMembers',
      );
      const roles: Record<string, OrgRole> = {};
      for (const m of rows) {
        if (ORG_ROLES.includes(m.role as OrgRole)) {
          roles[m.userId] = m.role as OrgRole;
        }
      }
      return roles;
    },
    [],
    {},
  );

  const currentUserId = userStore.currentUser?.id ?? null;
  const viewerRole = currentUserId ? memberRoles[currentUserId] : undefined;
  const isOwner = viewerRole === 'owner';
  // Derived from the viewer's actual role rather than from whether an
  // admin-only query happened to succeed: a network failure on the invites
  // request must not silently strip an owner of their management controls.
  const canManage = viewerRole === 'owner' || viewerRole === 'admin';

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

  // The roster is the members query intersected with synced users: a user row
  // can linger in the store after removal (nothing deletes Users), so
  // `memberRoles` decides who is still in the workspace.
  const members = userStore.all.filter(u => memberRoles[u.id] !== undefined);

  async function updateMemberRole(userId: string, role: OrgRole) {
    setUpdatingRole(userId);
    const previous = memberRoles[userId];
    try {
      await gqlMutate(UPDATE_ORG_MEMBER_ROLE_MUTATION, { role, userId });
      setMemberRoles(prev => ({ ...prev, [userId]: role }));
      toast.success(t('settings.workspace.memberRoleUpdated'));
    } catch (err) {
      // Restore the previous value so the select doesn't display a role
      // the server rejected (e.g. an admin attempting to grant owner).
      if (previous) {
        setMemberRoles(prev => ({ ...prev, [userId]: previous }));
      }
      toast.error(getErrorMessage(err, t('settings.workspace.memberRoleUpdateError')));
    } finally {
      setUpdatingRole(null);
    }
  }

  async function removeMember(target: RemovalTarget) {
    setRemoving(target.userId);
    try {
      await gqlMutate(ORGANIZATION_MEMBER_REMOVE_MUTATION, { userId: target.userId });
      setMemberRoles(prev => {
        const next = { ...prev };
        delete next[target.userId];
        return next;
      });
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
          {rosterError ? (
            <InlineRetry
              className="px-5"
              message={t('settings.workspace.membersLoadError')}
              onRetry={() => void refetchRoster()}
            />
          ) : members.length === 0 ? (
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
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
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
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
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
