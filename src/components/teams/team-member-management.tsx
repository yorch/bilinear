'use client';

import { Crown, UserMinus, UserPlus, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';

export type TeamRole = 'admin' | 'member' | 'guest';

export interface TeamMember {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  email: string;
  initials: string;
  isOwner: boolean;
  membershipId: string;
  role?: TeamRole;
  userId: string;
}

export interface OrgUser {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  email: string;
  id: string;
  initials: string;
}

interface TeamMemberManagementProps {
  currentUserId: string;
  members: TeamMember[];
  onAddMember: (userId: string) => Promise<void>;
  onRemoveMember: (membershipId: string) => Promise<void>;
  onToggleOwner: (membershipId: string, isOwner: boolean) => Promise<void>;
  onUpdateRole?: (membershipId: string, role: TeamRole) => Promise<void>;
  orgUsers: OrgUser[];
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  guest: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  member: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

function Avatar({
  user,
  size = 'md',
}: {
  user: {
    initials: string;
    avatarUrl?: string | null;
    avatarBackgroundColor: string;
    displayName: string;
  };
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm';
  const px = size === 'sm' ? 24 : 32;
  if (user.avatarUrl) {
    return (
      <Image
        alt={user.displayName}
        className={cn('rounded-full object-cover', dim)}
        height={px}
        src={user.avatarUrl}
        unoptimized
        width={px}
      />
    );
  }
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-medium text-white',
        dim,
      )}
      style={{ backgroundColor: user.avatarBackgroundColor }}
    >
      {user.initials}
    </span>
  );
}

export function TeamMemberManagement({
  members,
  orgUsers,
  currentUserId,
  onAddMember,
  onRemoveMember,
  onToggleOwner,
  onUpdateRole,
}: TeamMemberManagementProps) {
  const t = useTranslations();
  const ROLE_LABELS: Record<TeamRole, string> = {
    admin: t('teams.roleAdmin'),
    guest: t('teams.roleGuest'),
    member: t('teams.roleMember'),
  };
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [loadingMembershipId, setLoadingMembershipId] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const memberUserIds = useMemo(() => new Set(members.map(m => m.userId)), [members]);
  const canManageMembers = useMemo(
    () => members.some(m => m.userId === currentUserId && m.isOwner),
    [members, currentUserId],
  );
  const availableUsers = useMemo(
    () =>
      orgUsers.filter(
        u => !memberUserIds.has(u.id) && u.displayName.toLowerCase().includes(search.toLowerCase()),
      ),
    [orgUsers, memberUserIds, search],
  );

  useEffect(() => {
    if (addOpen) {
      setSearch('');
      setPendingRemoveId(null);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [addOpen]);

  const handleAdd = async (userId: string) => {
    setAdding(true);
    try {
      await onAddMember(userId);
      setAddOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, t('teams.failedToAddMember')));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (membershipId: string) => {
    setLoadingMembershipId(membershipId);
    try {
      await onRemoveMember(membershipId);
    } catch (err) {
      toast.error(getErrorMessage(err, t('teams.failedToRemoveMember')));
    } finally {
      setLoadingMembershipId(null);
    }
  };

  const handleToggleOwner = async (membershipId: string, currentIsOwner: boolean) => {
    setLoadingMembershipId(membershipId);
    try {
      await onToggleOwner(membershipId, !currentIsOwner);
    } catch (err) {
      toast.error(getErrorMessage(err, t('teams.failedToUpdateRole')));
    } finally {
      setLoadingMembershipId(null);
    }
  };

  const handleUpdateRole = async (membershipId: string, role: TeamRole) => {
    if (!onUpdateRole) {
      return;
    }
    setLoadingMembershipId(membershipId);
    try {
      await onUpdateRole(membershipId, role);
    } catch (err) {
      toast.error(getErrorMessage(err, t('teams.failedToUpdateRole')));
    } finally {
      setLoadingMembershipId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map(member => {
          const isLoading = loadingMembershipId === member.membershipId;
          const isSelf = member.userId === currentUserId;
          return (
            <li className="flex items-center gap-3 py-2.5" key={member.membershipId}>
              <Avatar user={member} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {member.displayName}
                    {isSelf && (
                      <span className="ml-1 text-xs text-zinc-400">({t('teams.you')})</span>
                    )}
                  </span>
                  {member.isOwner && (
                    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <Crown className="h-2.5 w-2.5" />
                      {t('teams.owner')}
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-400 truncate">{member.email}</span>
              </div>
              {/* Role badge / selector */}
              {member.role && (
                <div className="shrink-0">
                  {canManageMembers && onUpdateRole ? (
                    <select
                      className={cn(
                        'appearance-none rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer border border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50',
                        ROLE_COLORS[member.role],
                      )}
                      disabled={isLoading}
                      onChange={e =>
                        handleUpdateRole(member.membershipId, e.target.value as TeamRole)
                      }
                      value={member.role}
                    >
                      {(Object.keys(ROLE_LABELS) as TeamRole[]).map(r => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        ROLE_COLORS[member.role],
                      )}
                    >
                      {ROLE_LABELS[member.role]}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1">
                {pendingRemoveId === member.membershipId ? (
                  <>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {isSelf ? t('teams.leaveConfirm') : t('teams.removeConfirm')}
                    </span>
                    <button
                      className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      disabled={isLoading}
                      onClick={() => {
                        setPendingRemoveId(null);
                        handleRemove(member.membershipId);
                      }}
                      type="button"
                    >
                      {isLoading ? '…' : t('teams.yes')}
                    </button>
                    <button
                      className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => setPendingRemoveId(null)}
                      type="button"
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <>
                    {canManageMembers && (
                      <button
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded text-xs transition-colors disabled:opacity-50',
                          member.isOwner
                            ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                            : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
                        )}
                        disabled={isLoading}
                        onClick={() => handleToggleOwner(member.membershipId, member.isOwner)}
                        title={member.isOwner ? t('teams.removeOwnerRole') : t('teams.makeOwner')}
                        type="button"
                      >
                        <Crown className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(canManageMembers || isSelf) && (
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        disabled={isLoading}
                        onClick={() => setPendingRemoveId(member.membershipId)}
                        title={isSelf ? t('teams.leaveTeam') : t('teams.removeMember')}
                        type="button"
                      >
                        {isSelf ? (
                          <X className="h-3.5 w-3.5" />
                        ) : (
                          <UserMinus className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {addOpen ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <input
            className="w-full bg-transparent px-2 py-1 text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
            onChange={e => setSearch(e.target.value)}
            placeholder={t('teams.searchMembersToAdd')}
            ref={searchRef}
            type="text"
            value={search}
          />
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {availableUsers.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-zinc-400">
                {search ? t('teams.noMatches') : t('teams.allMembersAlreadyInTeam')}
              </li>
            ) : (
              availableUsers.map(user => (
                <li key={user.id}>
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                    disabled={adding}
                    onClick={() => handleAdd(user.id)}
                    type="button"
                  >
                    <Avatar size="sm" user={user} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {user.displayName}
                      </p>
                      <p className="truncate text-xs text-zinc-400">{user.email}</p>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="mt-2 flex justify-end">
            <button
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onClick={() => setAddOpen(false)}
              type="button"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="flex items-center gap-1.5 self-start rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          onClick={() => setAddOpen(true)}
          type="button"
        >
          <UserPlus className="h-4 w-4" />
          {t('teams.addMember')}
        </button>
      )}
    </div>
  );
}
