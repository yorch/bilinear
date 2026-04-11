'use client';

import { ChevronRight, Lock, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const ORGANIZATION_QUERY = `
  query Organization {
    organization {
      id
      name
      urlKey
      dataRegion
      createdAt
    }
    organizationMembers {
      userId
      role
    }
  }
`;

const UPDATE_ORG_MEMBER_ROLE_MUTATION = `
  mutation UpdateOrgMemberRole($userId: ID!, $role: String!) {
    organizationMemberUpdateRole(userId: $userId, role: $role) {
      success
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgInfo {
  id: string;
  name: string;
  urlKey: string;
  dataRegion: string;
  createdAt: string;
}

const ORG_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_BADGES: Record<OrgRole, { label: string; cls: string }> = {
  admin: {
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    label: 'Admin',
  },
  guest: {
    cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    label: 'Guest',
  },
  member: {
    cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    label: 'Member',
  },
  owner: {
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    label: 'Owner',
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const WorkspaceSettingsPage = observer(function WorkspaceSettingsPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const { userStore, teamStore } = useStore();

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [memberRoles, setMemberRoles] = useState<Record<string, OrgRole>>({});

  useEffect(() => {
    let cancelled = false;
    gql(ORGANIZATION_QUERY)
      .then(result => {
        if (cancelled) {
          return;
        }
        const data = result.data as
          | {
              organization?: OrgInfo;
              organizationMembers?: { userId: string; role: string }[];
            }
          | undefined;
        if (data?.organization) {
          setOrg(data.organization);
        }
        if (data?.organizationMembers) {
          const roles: Record<string, OrgRole> = {};
          for (const m of data.organizationMembers) {
            if (ORG_ROLES.includes(m.role as OrgRole)) {
              roles[m.userId] = m.role as OrgRole;
            }
          }
          setMemberRoles(roles);
        }
      })
      .catch(() => {
        /* keep org null; page degrades gracefully */
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const members = userStore.all;
  const allTeams = teamStore.all;
  const teams = useMemo(() => {
    const rootTeams = allTeams.filter(t => !t.parentId);
    const childTeamsByParent = allTeams.reduce<Record<string, typeof allTeams>>(
      (acc, t) => {
        if (t.parentId) {
          if (!acc[t.parentId]) {
            acc[t.parentId] = [];
          }
          acc[t.parentId].push(t);
        }
        return acc;
      },
      {},
    );
    return rootTeams.flatMap(t => [t, ...(childTeamsByParent[t.id] ?? [])]);
  }, [allTeams]);

  const updateMemberRole = async (userId: string, role: OrgRole) => {
    setUpdatingRole(userId);
    try {
      await gql(UPDATE_ORG_MEMBER_ROLE_MUTATION, { role, userId });
      setMemberRoles(prev => ({ ...prev, [userId]: role }));
      toast.success('Member role updated');
    } catch {
      toast.error('Failed to update member role');
    } finally {
      setUpdatingRole(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Workspace Settings
        </h1>
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Organization
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
            {loading ? (
              <div className="flex flex-col gap-4 animate-pulse">
                <div className="h-4 w-48 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
              </div>
            ) : org ? (
              <dl className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-0.5">
                    Name
                  </dt>
                  <dd className="col-span-2 text-sm text-zinc-900 dark:text-zinc-100">
                    {org.name}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-0.5">
                    URL key
                  </dt>
                  <dd className="col-span-2 font-mono text-sm text-zinc-700 dark:text-zinc-300">
                    {org.urlKey}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-0.5">
                    Data region
                  </dt>
                  <dd className="col-span-2 text-sm text-zinc-700 dark:text-zinc-300 capitalize">
                    {org.dataRegion}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-0.5">
                    Created
                  </dt>
                  <dd className="col-span-2 text-sm text-zinc-500 dark:text-zinc-400">
                    {new Date(org.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-zinc-400">
                Could not load organization details.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Teams
            <span className="ml-2 font-normal normal-case text-zinc-300 dark:text-zinc-600">
              {teams.length}
            </span>
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
            {teams.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                No teams yet. Create one from the sidebar.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {teams.map(team => {
                  const isChild = !!team.parentId;
                  return (
                    <li
                      key={team.id}
                      className={cn(
                        isChild &&
                          'border-l-2 border-indigo-200 dark:border-indigo-800 ml-4',
                      )}
                    >
                      <Link
                        href={`/${workspace}/team/${team.key}/settings`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                      >
                        {isChild && (
                          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />
                        )}
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-sm dark:bg-zinc-800">
                          {team.icon ? (
                            <span>{team.icon}</span>
                          ) : (
                            <Users className="h-4 w-4 text-zinc-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {team.displayName || team.name}
                          </p>
                          {team.description && (
                            <p className="text-xs text-zinc-400 truncate">
                              {team.description}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                          {team.key}
                        </span>
                        {team.private && (
                          <span className="flex items-center gap-1 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            <Lock className="h-2.5 w-2.5" />
                            Private
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Members
            <span className="ml-2 font-normal normal-case text-zinc-300 dark:text-zinc-600">
              {members.length}
            </span>
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
            {members.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                No members found.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {members.map(user => {
                  const currentRole = (memberRoles[user.id] ??
                    'member') as OrgRole;
                  const roleBadge = ROLE_BADGES[currentRole];
                  const isUpdating = updatingRole === user.id;
                  return (
                    <li
                      key={user.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      {user.avatarUrl ? (
                        <Image
                          src={user.avatarUrl}
                          alt={user.displayName}
                          width={28}
                          height={28}
                          unoptimized
                          className="h-7 w-7 rounded-full object-cover shrink-0"
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
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {user.displayName}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">
                          {user.email}
                        </p>
                      </div>
                      {!user.active && (
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">
                          Inactive
                        </span>
                      )}
                      {/* Role badge + dropdown */}
                      <div className="relative shrink-0">
                        <select
                          value={currentRole}
                          disabled={isUpdating}
                          onChange={e =>
                            updateMemberRole(user.id, e.target.value as OrgRole)
                          }
                          className={cn(
                            'appearance-none rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer',
                            'border border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-400',
                            'disabled:opacity-50 disabled:cursor-not-allowed',
                            roleBadge.cls,
                          )}
                        >
                          {ORG_ROLES.map(r => (
                            <option key={r} value={r}>
                              {ROLE_BADGES[r].label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
});

export default WorkspaceSettingsPage;
