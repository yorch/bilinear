'use client';

import { Calendar, ChevronRight, Copy, Key, Lock, RefreshCw, Trash2, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
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
  { days: 30, labelKey: 'settings.tokenExpiry.30' },
  { days: 90, labelKey: 'settings.tokenExpiry.90' },
  { days: 365, labelKey: 'settings.tokenExpiry.365' },
  { days: 730, labelKey: 'settings.tokenExpiry.730' },
] as const;

const ORG_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_BADGES: Record<OrgRole, { labelKey: string; cls: string }> = {
  admin: {
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    labelKey: 'settings.roles.admin',
  },
  guest: {
    cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    labelKey: 'settings.roles.guest',
  },
  member: {
    cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    labelKey: 'settings.roles.member',
  },
  owner: {
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    labelKey: 'settings.roles.owner',
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const WorkspaceSettingsPage = observer(function WorkspaceSettingsPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const { userStore, teamStore } = useStore();
  const t = useTranslations();
  const { formatDate } = useFormatters();

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
      toast.success(
        enabled ? t('settings.workspace.aiEnabledToast') : t('settings.workspace.aiDisabledToast'),
      );
    } catch {
      setOrg(prev => (prev ? { ...prev, aiEnabled: !enabled } : prev));
      toast.error(t('settings.workspace.aiUpdateError'));
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
      toast.error(t('settings.workspace.apiTokenCreateError'));
    } finally {
      setCreatingToken(false);
    }
  }

  async function revokeApiToken(id: string) {
    setRevokingTokenId(id);
    try {
      await gql(API_TOKEN_REVOKE_MUTATION, { id });
      setApiTokens(prev => prev.filter(tok => tok.id !== id));
      toast.success(t('settings.workspace.tokenRevoked'));
    } catch {
      toast.error(t('settings.workspace.tokenRevokeError'));
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
      toast.success(t('settings.workspace.calendarUrlRotated'));
    } catch {
      toast.error(t('settings.workspace.calendarUrlRotateError'));
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
      toast.error(t('settings.workspace.notificationPrefsError'));
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
      toast.success(t('settings.workspace.memberRoleUpdated'));
    } catch {
      toast.error(t('settings.workspace.memberRoleUpdateError'));
    } finally {
      setUpdatingRole(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-foreground">{t('settings.workspace.title')}</h1>
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.organization')}
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
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.name')}
                  </dt>
                  <dd className="col-span-2 text-sm text-foreground">{org.name}</dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.urlKey')}
                  </dt>
                  <dd className="col-span-2 font-mono text-sm text-zinc-700 dark:text-zinc-300">
                    {org.urlKey}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.dataRegion')}
                  </dt>
                  <dd className="col-span-2 text-sm text-zinc-700 dark:text-zinc-300 capitalize">
                    {org.dataRegion}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.created')}
                  </dt>
                  <dd className="col-span-2 text-sm text-muted-foreground">
                    {formatDate(org.createdAt, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-zinc-400">{t('settings.workspace.orgLoadError')}</p>
            )}
          </div>
        </section>

        {isPlatformAdmin && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings.workspace.platform')}
            </h2>
            <Link
              className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-5 py-4 transition-colors hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50"
              href="/admin"
            >
              <div>
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                  {t('settings.workspace.platformAdminConsole')}
                </p>
                <p className="text-xs text-indigo-700/70 dark:text-indigo-300/70">
                  {t('settings.workspace.platformAdminConsoleDescription')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400" />
            </Link>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.teams')}
            <span className="ml-2 font-normal normal-case text-zinc-300 dark:text-zinc-600">
              {teams.length}
            </span>
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
            {teams.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                {t('settings.workspace.noTeamsYet')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
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
                        className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50 transition-colors"
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
                          <p className="text-sm font-medium text-foreground truncate">
                            {team.displayName || team.name}
                          </p>
                          {team.description && (
                            <p className="text-xs text-zinc-400 truncate">{team.description}</p>
                          )}
                        </div>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {team.key}
                        </span>
                        {team.private && (
                          <span className="flex items-center gap-1 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            <Lock className="h-2.5 w-2.5" />
                            {t('settings.workspace.private')}
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
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.members')}
            <span className="ml-2 font-normal normal-case text-zinc-300 dark:text-zinc-600">
              {members.length}
            </span>
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
            {members.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                {t('settings.workspace.noMembersFound')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
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
                        <p className="text-sm font-medium text-foreground truncate">
                          {user.displayName}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">{user.email}</p>
                      </div>
                      {!user.active && (
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">
                          {t('settings.workspace.inactive')}
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
                              {t(ROLE_BADGES[r].labelKey)}
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
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.myPreferences')}
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 divide-y divide-border">
            {/* Email notifications toggle */}
            <div className="px-5 py-3">
              <SettingToggleRow
                checked={emailNotificationsEnabled}
                description={t('settings.workspace.emailNotificationsDescription')}
                label={t('settings.workspace.emailNotifications')}
                onCheckedChange={checked => toggleEmailNotifications(checked)}
              />
            </div>

            {/* iCal cycle feed */}
            <div className="px-5 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                    {t('settings.workspace.cycleCalendarFeed')}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {t('settings.workspace.cycleCalendarFeedDescription')}
                  </p>
                  {calendarFeedUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="truncate max-w-xs text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                        {calendarFeedUrl}
                      </code>
                      <button
                        className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                        onClick={() => {
                          void navigator.clipboard.writeText(calendarFeedUrl);
                          toast.success(t('settings.workspace.copiedToClipboard'));
                        }}
                        title={t('settings.workspace.copyUrl')}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className={cn(
                    'shrink-0 flex items-center gap-1.5 rounded-md border border-border',
                    'px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300',
                    'hover:bg-accent disabled:opacity-50',
                  )}
                  disabled={rotatingToken}
                  onClick={rotateCalendarToken}
                  type="button"
                >
                  <RefreshCw className={cn('h-3 w-3', rotatingToken && 'animate-spin')} />
                  {calendarFeedUrl
                    ? t('settings.workspace.rotate')
                    : t('settings.workspace.generate')}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* API tokens */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.apiTokens')}
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 divide-y divide-border">
            {/* New plaintext banner — shown only once after creation */}
            {newPlaintext && (
              <div className="px-5 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5">
                  {t('settings.workspace.copyTokenNowWarning')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-700 px-2 py-1 rounded text-zinc-700 dark:text-zinc-300 font-mono">
                    {newPlaintext}
                  </code>
                  <button
                    className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
                    onClick={() => {
                      void navigator.clipboard.writeText(newPlaintext);
                      toast.success(t('settings.workspace.copiedToClipboard'));
                    }}
                    title={t('settings.workspace.copyToken')}
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
                  {t('settings.workspace.iHaveCopiedIt')}
                </button>
              </div>
            )}

            {/* Create new token */}
            <div className="px-5 py-3">
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5 mb-2">
                <Key className="h-3.5 w-3.5 text-zinc-400" />
                {t('settings.workspace.createToken')}
              </p>
              <div className="flex items-center gap-2">
                <input
                  className={cn(
                    'flex-1 rounded-md border border-border bg-transparent',
                    'px-3 py-1.5 text-sm text-foreground placeholder-zinc-400',
                    'focus:outline-none focus:ring-1 focus:ring-indigo-500',
                  )}
                  disabled={creatingToken}
                  onChange={e => setNewTokenLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      void createApiToken();
                    }
                  }}
                  placeholder={t('settings.workspace.tokenLabel')}
                  type="text"
                  value={newTokenLabel}
                />
                <button
                  className={cn(
                    'shrink-0 rounded-md border border-border',
                    'px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300',
                    'hover:bg-accent disabled:opacity-50',
                  )}
                  disabled={creatingToken || !newTokenLabel.trim()}
                  onClick={() => void createApiToken()}
                  type="button"
                >
                  {creatingToken ? t('settings.workspace.creatingEllipsis') : t('common.create')}
                </button>
              </div>
              {/* Scope + expiry controls */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  <input
                    checked={newTokenWritable}
                    className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                    disabled={creatingToken}
                    onChange={e => setNewTokenWritable(e.target.checked)}
                    type="checkbox"
                  />
                  {t('settings.workspace.allowWrite')}
                </label>
                <label className="flex items-center gap-1.5">
                  {t('settings.workspace.expiresIn')}
                  <select
                    className={cn(
                      'rounded-md border border-border bg-transparent',
                      'px-1.5 py-0.5 text-xs text-zinc-700 dark:text-zinc-300',
                      'focus:outline-none focus:ring-1 focus:ring-indigo-500',
                    )}
                    disabled={creatingToken}
                    onChange={e => setNewTokenExpiryDays(Number(e.target.value))}
                    value={newTokenExpiryDays}
                  >
                    {TOKEN_EXPIRY_OPTIONS.map(opt => (
                      <option key={opt.days} value={opt.days}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                {!newTokenWritable && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {t('settings.workspace.readOnlyKey')}
                  </span>
                )}
              </div>
            </div>

            {/* Token list */}
            {apiTokens.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                {t('settings.workspace.noApiTokensYet')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {apiTokens.map(token => (
                  <li className="flex items-start gap-3 px-5 py-3" key={token.id}>
                    <Key className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate flex items-center gap-2">
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
                            ? t('settings.workspace.readWrite')
                            : t('settings.workspace.readOnly')}
                        </span>
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {t('settings.workspace.created')}{' '}
                        {formatDate(token.createdAt, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {' · '}
                        {token.lastUsedAt
                          ? t('settings.workspace.lastUsedOn', {
                              date: formatDate(token.lastUsedAt, {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              }),
                            })
                          : t('settings.workspace.neverUsed')}
                        {' · '}
                        {t('settings.workspace.expires')}{' '}
                        {formatDate(token.expiresAt, {
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
                        if (
                          window.confirm(
                            t('settings.workspace.revokeTokenConfirm', { label: token.label }),
                          )
                        ) {
                          void revokeApiToken(token.id);
                        }
                      }}
                      title={t('settings.workspace.revokeToken')}
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
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.ai')}
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-5 py-4">
            <SettingToggleRow
              checked={org?.aiEnabled ?? false}
              description={t('settings.workspace.aiAssistantDescription')}
              disabled={savingAi || !org}
              label={t('settings.workspace.aiAssistant')}
              onCheckedChange={checked => void toggleAi(checked)}
            />
          </div>
        </section>

        {/* Quick links to sub-settings */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.configuration')}
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
            <ul className="divide-y divide-border">
              {[
                {
                  description: t('settings.workspace.integrationsDescription'),
                  href: `/${workspace}/settings/integrations`,
                  label: t('settings.workspace.integrations'),
                },
                {
                  description: t('settings.workspace.securityDescription'),
                  href: `/${workspace}/settings/security`,
                  label: t('settings.workspace.security'),
                },
                {
                  description: t('settings.workspace.webhooksDescription'),
                  href: `/${workspace}/settings/webhooks`,
                  label: t('settings.workspace.webhooks'),
                },
                {
                  description: t('settings.workspace.importExportDescription'),
                  href: `/${workspace}/settings/import`,
                  label: t('settings.workspace.importExport'),
                },
                {
                  description: t('settings.workspace.publicRoadmapDescription'),
                  href: `/${workspace}/settings/roadmap`,
                  label: t('settings.workspace.publicRoadmap'),
                },
                {
                  description: t('settings.workspace.automationsDescription'),
                  href: `/${workspace}/settings/automations`,
                  label: t('settings.workspace.automations'),
                },
                {
                  description: t('settings.workspace.auditLogDescription'),
                  href: `/${workspace}/settings/audit-log`,
                  label: t('settings.workspace.auditLog'),
                },
              ].map(item => (
                <li key={item.href}>
                  <Link
                    className="flex items-center justify-between px-5 py-3 hover:bg-accent/50 transition-colors"
                    href={item.href}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
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
