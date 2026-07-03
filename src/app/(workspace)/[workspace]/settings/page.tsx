'use client';

import { Calendar, ChevronRight, Copy, Key, Lock, RefreshCw, Trash2, Users } from 'lucide-react';
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
      aiEnabled
      createdAt
    }
    organizationMembers {
      userId
      role
    }
  }
`;

const AI_SETTINGS_UPDATE_MUTATION = `
  mutation AiSettingsUpdate($enabled: Boolean!) {
    aiSettingsUpdate(enabled: $enabled) {
      success
      organization { id aiEnabled }
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

const VIEWER_QUERY = `
  query ViewerCalendar {
    viewer {
      id
      emailNotificationsEnabled
      calendarFeedUrl
      isPlatformAdmin
    }
  }
`;

const ROTATE_CALENDAR_TOKEN_MUTATION = `
  mutation RotateCalendarToken {
    userCalendarFeedTokenRotate {
      success
      user { calendarFeedUrl }
    }
  }
`;

const UPDATE_NOTIFICATION_PREFS_MUTATION = `
  mutation UpdateNotificationPrefs($emailNotificationsEnabled: Boolean!) {
    userUpdateNotificationPreferences(emailNotificationsEnabled: $emailNotificationsEnabled) {
      success
    }
  }
`;

const API_TOKENS_QUERY = `
  query ApiTokens { apiTokens { id label scopes lastUsedAt createdAt expiresAt } }
`;

const API_TOKEN_CREATE_MUTATION = `
  mutation ApiTokenCreate($label: String!, $scopes: [String!], $expiresInDays: Int) {
    apiTokenCreate(label: $label, scopes: $scopes, expiresInDays: $expiresInDays) {
      success
      plaintext
      token { id label scopes lastUsedAt createdAt expiresAt }
    }
  }
`;

const API_TOKEN_REVOKE_MUTATION = `
  mutation ApiTokenRevoke($id: ID!) { apiTokenRevoke(id: $id) { success } }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgInfo {
  aiEnabled: boolean;
  createdAt: string;
  dataRegion: string;
  id: string;
  name: string;
  urlKey: string;
}

interface ApiToken {
  createdAt: string;
  expiresAt: string;
  id: string;
  label: string;
  lastUsedAt: string | null;
  scopes: string[];
}

// Expiry presets offered in the create form (days).
const TOKEN_EXPIRY_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
] as const;

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
  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [rotatingToken, setRotatingToken] = useState(false);
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [newTokenLabel, setNewTokenLabel] = useState('');
  const [newTokenWritable, setNewTokenWritable] = useState(true);
  const [newTokenExpiryDays, setNewTokenExpiryDays] = useState(365);
  const [creatingToken, setCreatingToken] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [savingAi, setSavingAi] = useState(false);

  async function toggleAi(enabled: boolean) {
    setSavingAi(true);
    // Optimistic — revert on error.
    setOrg(prev => (prev ? { ...prev, aiEnabled: enabled } : prev));
    try {
      await gql(AI_SETTINGS_UPDATE_MUTATION, { enabled });
      toast.success(enabled ? 'AI features enabled' : 'AI features disabled');
    } catch {
      setOrg(prev => (prev ? { ...prev, aiEnabled: !enabled } : prev));
      toast.error('Failed to update AI settings');
    } finally {
      setSavingAi(false);
    }
  }

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

  useEffect(() => {
    gql(VIEWER_QUERY)
      .then(result => {
        const data = result.data as
          | {
              viewer?: {
                calendarFeedUrl?: string | null;
                emailNotificationsEnabled?: boolean;
                isPlatformAdmin?: boolean;
              };
            }
          | undefined;
        if (data?.viewer) {
          setCalendarFeedUrl(data.viewer.calendarFeedUrl ?? null);
          setEmailNotificationsEnabled(data.viewer.emailNotificationsEnabled ?? true);
          setIsPlatformAdmin(data.viewer.isPlatformAdmin ?? false);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    gql(API_TOKENS_QUERY)
      .then(result => {
        const data = result.data as { apiTokens?: ApiToken[] } | undefined;
        setApiTokens(data?.apiTokens ?? []);
      })
      .catch(() => {});
  }, []);

  async function createApiToken() {
    if (!newTokenLabel.trim()) {
      return;
    }
    setCreatingToken(true);
    try {
      const result = await gql(API_TOKEN_CREATE_MUTATION, {
        expiresInDays: newTokenExpiryDays,
        label: newTokenLabel.trim(),
        // Read access is always granted; write is opt-in via the toggle.
        scopes: newTokenWritable ? ['read', 'write'] : ['read'],
      });
      const data = result.data as
        | { apiTokenCreate?: { plaintext: string; token: ApiToken } }
        | undefined;
      if (data?.apiTokenCreate?.token) {
        const { token, plaintext } = data.apiTokenCreate;
        setApiTokens(prev => [token as ApiToken, ...prev]);
        setNewPlaintext(plaintext);
        setNewTokenLabel('');
      }
    } catch {
      toast.error('Failed to create API token');
    } finally {
      setCreatingToken(false);
    }
  }

  async function revokeApiToken(id: string) {
    setRevokingTokenId(id);
    try {
      await gql(API_TOKEN_REVOKE_MUTATION, { id });
      setApiTokens(prev => prev.filter(t => t.id !== id));
      toast.success('Token revoked');
    } catch {
      toast.error('Failed to revoke token');
    } finally {
      setRevokingTokenId(null);
    }
  }

  async function rotateCalendarToken() {
    setRotatingToken(true);
    try {
      const result = await gql(ROTATE_CALENDAR_TOKEN_MUTATION);
      const url =
        (
          result.data as
            | { userCalendarFeedTokenRotate?: { user?: { calendarFeedUrl?: string } } }
            | undefined
        )?.userCalendarFeedTokenRotate?.user?.calendarFeedUrl ?? null;
      setCalendarFeedUrl(url);
      toast.success('Calendar feed URL rotated');
    } catch {
      toast.error('Failed to rotate calendar URL');
    } finally {
      setRotatingToken(false);
    }
  }

  async function toggleEmailNotifications(enabled: boolean) {
    setEmailNotificationsEnabled(enabled);
    try {
      await gql(UPDATE_NOTIFICATION_PREFS_MUTATION, { emailNotificationsEnabled: enabled });
    } catch {
      setEmailNotificationsEnabled(!enabled);
      toast.error('Failed to update notification preferences');
    }
  }

  const members = userStore.all;
  const allTeams = teamStore.all;
  const teams = useMemo(() => {
    const rootTeams = allTeams.filter(t => !t.parentId);
    const childTeamsByParent = allTeams.reduce<Record<string, typeof allTeams>>((acc, t) => {
      if (t.parentId) {
        if (!acc[t.parentId]) {
          acc[t.parentId] = [];
        }
        acc[t.parentId].push(t);
      }
      return acc;
    }, {});
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
              <p className="text-sm text-zinc-400">Could not load organization details.</p>
            )}
          </div>
        </section>

        {isPlatformAdmin && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Platform
            </h2>
            <Link
              className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-5 py-4 transition-colors hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50"
              href="/admin"
            >
              <div>
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                  Platform admin console
                </p>
                <p className="text-xs text-indigo-700/70 dark:text-indigo-300/70">
                  Manage tenants, users, and impersonation across every organization
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400" />
            </Link>
          </section>
        )}

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
                      className={cn(
                        isChild && 'border-l-2 border-indigo-200 dark:border-indigo-800 ml-4',
                      )}
                      key={team.id}
                    >
                      <Link
                        className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                        href={`/${workspace}/team/${team.key}/settings`}
                      >
                        {isChild && <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}
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
                            <p className="text-xs text-zinc-400 truncate">{team.description}</p>
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
              <p className="px-5 py-4 text-sm text-zinc-400">No members found.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {members.map(user => {
                  const currentRole = (memberRoles[user.id] ?? 'member') as OrgRole;
                  const roleBadge = ROLE_BADGES[currentRole];
                  const isUpdating = updatingRole === user.id;
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
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {user.displayName}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">{user.email}</p>
                      </div>
                      {!user.active && (
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">
                          Inactive
                        </span>
                      )}
                      {/* Role badge + dropdown */}
                      <div className="relative shrink-0">
                        <select
                          className={cn(
                            'appearance-none rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer',
                            'border border-transparent focus:outline-none focus:ring-1 focus:ring-indigo-400',
                            'disabled:opacity-50 disabled:cursor-not-allowed',
                            roleBadge.cls,
                          )}
                          disabled={isUpdating}
                          onChange={e => updateMemberRole(user.id, e.target.value as OrgRole)}
                          value={currentRole}
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

        {/* Personal preferences */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            My Preferences
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* Email notifications toggle */}
            <div className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Email notifications
                </p>
                <p className="text-xs text-zinc-400">
                  Receive emails for assignments, mentions, and status changes
                </p>
              </div>
              <button
                aria-checked={emailNotificationsEnabled}
                aria-label="Email notifications"
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                  emailNotificationsEnabled ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700',
                )}
                onClick={() => toggleEmailNotifications(!emailNotificationsEnabled)}
                role="switch"
                type="button"
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    emailNotificationsEnabled ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </button>
            </div>

            {/* iCal cycle feed */}
            <div className="px-5 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                    Cycle calendar feed
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Subscribe to your cycles in Google Calendar, Apple Calendar, or any .ics client.
                  </p>
                  {calendarFeedUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="truncate max-w-xs text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-zinc-600 dark:text-zinc-300">
                        {calendarFeedUrl}
                      </code>
                      <button
                        className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                        onClick={() => {
                          void navigator.clipboard.writeText(calendarFeedUrl);
                          toast.success('Copied to clipboard');
                        }}
                        title="Copy URL"
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className={cn(
                    'shrink-0 flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700',
                    'px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300',
                    'hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50',
                  )}
                  disabled={rotatingToken}
                  onClick={rotateCalendarToken}
                  type="button"
                >
                  <RefreshCw className={cn('h-3 w-3', rotatingToken && 'animate-spin')} />
                  {calendarFeedUrl ? 'Rotate' : 'Generate'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* API tokens */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            API Tokens
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* New plaintext banner — shown only once after creation */}
            {newPlaintext && (
              <div className="px-5 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5">
                  Copy your token now — it will not be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-700 px-2 py-1 rounded text-zinc-700 dark:text-zinc-300 font-mono">
                    {newPlaintext}
                  </code>
                  <button
                    className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
                    onClick={() => {
                      void navigator.clipboard.writeText(newPlaintext);
                      toast.success('Copied to clipboard');
                    }}
                    title="Copy token"
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  className="mt-2 text-xs text-amber-600 dark:text-amber-400 hover:underline"
                  onClick={() => setNewPlaintext(null)}
                  type="button"
                >
                  I have copied it
                </button>
              </div>
            )}

            {/* Create new token */}
            <div className="px-5 py-3">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 mb-2">
                <Key className="h-3.5 w-3.5 text-zinc-400" />
                Create token
              </p>
              <div className="flex items-center gap-2">
                <input
                  className={cn(
                    'flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent',
                    'px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400',
                    'focus:outline-none focus:ring-1 focus:ring-indigo-500',
                  )}
                  disabled={creatingToken}
                  onChange={e => setNewTokenLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      void createApiToken();
                    }
                  }}
                  placeholder="Token label"
                  type="text"
                  value={newTokenLabel}
                />
                <button
                  className={cn(
                    'shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700',
                    'px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300',
                    'hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50',
                  )}
                  disabled={creatingToken || !newTokenLabel.trim()}
                  onClick={() => void createApiToken()}
                  type="button"
                >
                  {creatingToken ? 'Creating…' : 'Create'}
                </button>
              </div>
              {/* Scope + expiry controls */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
                <label className="flex items-center gap-1.5">
                  <input
                    checked={newTokenWritable}
                    className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                    disabled={creatingToken}
                    onChange={e => setNewTokenWritable(e.target.checked)}
                    type="checkbox"
                  />
                  Allow write (mutations)
                </label>
                <label className="flex items-center gap-1.5">
                  Expires in
                  <select
                    className={cn(
                      'rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent',
                      'px-1.5 py-0.5 text-xs text-zinc-700 dark:text-zinc-300',
                      'focus:outline-none focus:ring-1 focus:ring-indigo-500',
                    )}
                    disabled={creatingToken}
                    onChange={e => setNewTokenExpiryDays(Number(e.target.value))}
                    value={newTokenExpiryDays}
                  >
                    {TOKEN_EXPIRY_OPTIONS.map(opt => (
                      <option key={opt.days} value={opt.days}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!newTokenWritable && (
                  <span className="text-amber-600 dark:text-amber-400">Read-only key</span>
                )}
              </div>
            </div>

            {/* Token list */}
            {apiTokens.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">No API tokens yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {apiTokens.map(token => (
                  <li className="flex items-start gap-3 px-5 py-3" key={token.id}>
                    <Key className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-2">
                        {token.label}
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                            token.scopes.length === 0 || token.scopes.includes('write')
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
                          )}
                        >
                          {token.scopes.length === 0 || token.scopes.includes('write')
                            ? 'Read/Write'
                            : 'Read only'}
                        </span>
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Created{' '}
                        {new Date(token.createdAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {' · '}
                        {token.lastUsedAt
                          ? `Last used ${new Date(token.lastUsedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                          : 'Never used'}
                        {' · '}
                        Expires{' '}
                        {new Date(token.expiresAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <button
                      className="shrink-0 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40"
                      disabled={revokingTokenId === token.id}
                      onClick={() => {
                        if (window.confirm(`Revoke token "${token.label}"?`)) {
                          void revokeApiToken(token.id);
                        }
                      }}
                      title="Revoke token"
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* AI assistant */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            AI
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">AI assistant</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Title suggestions, issue summaries, and duplicate detection. Requires an Anthropic
                  API key configured on the server.
                </p>
              </div>
              <button
                aria-checked={org?.aiEnabled ?? false}
                aria-label="Enable AI assistant"
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50',
                  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                  org?.aiEnabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600',
                )}
                disabled={savingAi || !org}
                onClick={() => void toggleAi(!(org?.aiEnabled ?? false))}
                role="switch"
                type="button"
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    org?.aiEnabled ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Quick links to sub-settings */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Configuration
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[
                {
                  description: 'Connect GitHub and other services',
                  href: `/${workspace}/settings/integrations`,
                  label: 'Integrations',
                },
                {
                  description: 'SAML SSO and authentication policies',
                  href: `/${workspace}/settings/security`,
                  label: 'Security',
                },
                {
                  description: 'Send outbound HTTP events',
                  href: `/${workspace}/settings/webhooks`,
                  label: 'Webhooks',
                },
                {
                  description: 'Import issues from CSV, export data',
                  href: `/${workspace}/settings/import`,
                  label: 'Import / Export',
                },
                {
                  description: 'Share project status externally',
                  href: `/${workspace}/settings/roadmap`,
                  label: 'Public roadmap',
                },
                {
                  description: 'Security-relevant event history (admins only)',
                  href: `/${workspace}/settings/audit-log`,
                  label: 'Audit Log',
                },
              ].map(item => (
                <li key={item.href}>
                  <Link
                    className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    href={item.href}
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {item.label}
                      </p>
                      <p className="text-xs text-zinc-400">{item.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
});

export default WorkspaceSettingsPage;
