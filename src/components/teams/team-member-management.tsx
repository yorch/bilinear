'use client';

import { useEffect, useRef, useState } from 'react';
import { Crown, UserMinus, UserPlus, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export interface TeamMember {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBackgroundColor: string;
  isOwner: boolean;
}

export interface OrgUser {
  id: string;
  displayName: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBackgroundColor: string;
}

interface TeamMemberManagementProps {
  members: TeamMember[];
  orgUsers: OrgUser[];
  currentUserId: string;
  onAddMember: (userId: string) => Promise<void>;
  onRemoveMember: (membershipId: string) => Promise<void>;
  onToggleOwner: (membershipId: string, isOwner: boolean) => Promise<void>;
}

function Avatar({
  user,
  size = 'md',
}: {
  user: { initials: string; avatarUrl?: string | null; avatarBackgroundColor: string; displayName: string };
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm';
  const px = size === 'sm' ? 24 : 32;
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        width={px}
        height={px}
        className={cn('rounded-full object-cover', dim)}
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
}: TeamMemberManagementProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [loadingMembershipId, setLoadingMembershipId] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const memberUserIds = new Set(members.map(m => m.userId));
  const availableUsers = orgUsers.filter(
    u => !memberUserIds.has(u.id) && u.displayName.toLowerCase().includes(search.toLowerCase()),
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
      toast.error(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (membershipId: string) => {
    setLoadingMembershipId(membershipId);
    try {
      await onRemoveMember(membershipId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setLoadingMembershipId(null);
    }
  };

  const handleToggleOwner = async (membershipId: string, currentIsOwner: boolean) => {
    setLoadingMembershipId(membershipId);
    try {
      await onToggleOwner(membershipId, !currentIsOwner);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setLoadingMembershipId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Member list */}
      <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map(member => {
          const isLoading = loadingMembershipId === member.membershipId;
          const isSelf = member.userId === currentUserId;
          return (
            <li
              key={member.membershipId}
              className="flex items-center gap-3 py-2.5"
            >
              <Avatar user={member} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {member.displayName}
                    {isSelf && (
                      <span className="ml-1 text-xs text-zinc-400">(you)</span>
                    )}
                  </span>
                  {member.isOwner && (
                    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <Crown className="h-2.5 w-2.5" />
                      Owner
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-400 truncate">{member.email}</span>
              </div>
              <div className="flex items-center gap-1">
                {pendingRemoveId === member.membershipId ? (
                  /* Inline confirmation */
                  <>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {isSelf ? 'Leave?' : 'Remove?'}
                    </span>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => {
                        setPendingRemoveId(null);
                        handleRemove(member.membershipId);
                      }}
                      className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {isLoading ? '…' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemoveId(null)}
                      className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      title={member.isOwner ? 'Remove owner role' : 'Make owner'}
                      disabled={isLoading}
                      onClick={() => handleToggleOwner(member.membershipId, member.isOwner)}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded text-xs transition-colors disabled:opacity-50',
                        member.isOwner
                          ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
                      )}
                    >
                      <Crown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title={isSelf ? 'Leave team' : 'Remove member'}
                      disabled={isLoading}
                      onClick={() => setPendingRemoveId(member.membershipId)}
                      className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    >
                      {isSelf ? <X className="h-3.5 w-3.5" /> : <UserMinus className="h-3.5 w-3.5" />}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Add member */}
      {addOpen ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search members to add…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent px-2 py-1 text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
          />
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {availableUsers.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-zinc-400">
                {search ? 'No matches' : 'All org members are already in this team'}
              </li>
            ) : (
              availableUsers.map(user => (
                <li key={user.id}>
                  <button
                    type="button"
                    disabled={adding}
                    onClick={() => handleAdd(user.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    <Avatar user={user} size="sm" />
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
              type="button"
              onClick={() => setAddOpen(false)}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 self-start rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <UserPlus className="h-4 w-4" />
          Add member
        </button>
      )}
    </div>
  );
}
