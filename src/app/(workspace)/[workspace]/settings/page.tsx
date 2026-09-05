'use client';

import {
  Calendar,
  ChevronRight,
  Copy,
  ImagePlus,
  Key,
  Lock,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { AccentToggle } from '@/components/accent-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { MembersSection } from '@/components/settings/members-section';
import { WorkspaceCustomFieldsCard } from '@/components/settings/workspace-custom-fields-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { type OrganizationPlanLimits, PLAN_LIMIT_FIELDS } from '@/lib/plan-limits';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
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
      logoUrl
      dataRegion
      aiEnabled
      createdAt
      planLimits {
        maxCustomFieldsPerTeam
        maxCustomFieldsPerOrg
        maxLabelGroupChildren
        maxInitiativeDepth
        maxExportRows
      }
    }
  }
`;

const ORGANIZATION_UPDATE_MUTATION = `
  mutation OrganizationUpdate($input: OrganizationUpdateInput!) {
    organizationUpdate(input: $input) {
      success
      organization { id name logoUrl }
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
  logoUrl?: string | null;
  name: string;
  planLimits: OrganizationPlanLimits;
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Viewer {
  calendarFeedUrl?: string | null;
  emailNotificationsEnabled?: boolean;
  isPlatformAdmin?: boolean;
}

const WorkspaceSettingsPage = observer(function WorkspaceSettingsPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const { organizationMemberStore, teamStore, uiStore, userStore } = useStore();
  const t = useTranslations();
  useDocumentTitle(t('settings.workspace.title'));
  const { formatDate, intlLocale } = useFormatters();

  // `organizationUpdate` is owner/admin-only; mirror the guard so the form is
  // read-only for everyone the server would refuse.
  const viewerRole = userStore.currentUser
    ? organizationMemberStore.rolesByUserId[userStore.currentUser.id]
    : undefined;
  const canManageOrg = viewerRole === 'owner' || viewerRole === 'admin';

  const [orgName, setOrgName] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [rotatingToken, setRotatingToken] = useState(false);
  const [newTokenLabel, setNewTokenLabel] = useState('');
  const [newTokenWritable, setNewTokenWritable] = useState(true);
  const [newTokenExpiryDays, setNewTokenExpiryDays] = useState(365);
  const [creatingToken, setCreatingToken] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [confirmingRevokeToken, setConfirmingRevokeToken] = useState<ApiToken | null>(null);
  const [savingAi, setSavingAi] = useState(false);

  async function toggleAi(enabled: boolean) {
    setSavingAi(true);
    // Optimistic — revert on error.
    setOrg(prev => (prev ? { ...prev, aiEnabled: enabled } : prev));
    try {
      await gqlMutate(AI_SETTINGS_UPDATE_MUTATION, { enabled });
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

  const {
    data: orgData,
    error: orgLoadError,
    loading,
    refetch: reloadOrg,
    setData: setOrg,
  } = useRetryableFetch<OrgInfo | null>(
    async () =>
      (await gqlQuery<{ organization?: OrgInfo }>(ORGANIZATION_QUERY))?.organization ?? null,
    [],
    null,
    // The members roster used to ride this same document and no longer does —
    // MembersSection fetches and retries it independently.
    {
      onData: data => setOrgName(data?.name ?? ''),
      onError: err => toast.error(getErrorMessage(err, t('settings.workspace.orgLoadError'))),
    },
  );

  async function saveOrgName() {
    const trimmed = orgName.trim();
    if (!orgData || !trimmed || trimmed === orgData.name) {
      return;
    }
    setSavingOrg(true);
    try {
      await gqlMutate(ORGANIZATION_UPDATE_MUTATION, { input: { name: trimmed } });
      setOrg(prev => (prev ? { ...prev, name: trimmed } : prev));
      toast.success(t('settings.workspace.orgUpdated'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.orgUpdateError')));
    } finally {
      setSavingOrg(false);
    }
  }

  async function updateLogo(logoUrl: string | null) {
    await gqlMutate(ORGANIZATION_UPDATE_MUTATION, { input: { logoUrl } });
    setOrg(prev => (prev ? { ...prev, logoUrl } : prev));
    toast.success(t('settings.workspace.orgUpdated'));
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      // Same endpoint the issue attachments use; without an `issueId` the file
      // is stored against the org and only the URL comes back.
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { body: form, method: 'POST' });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? t('settings.workspace.logoUploadError'));
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        throw new Error(t('settings.workspace.logoUploadError'));
      }
      await updateLogo(data.url);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.logoUploadError')));
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  }

  async function removeLogo() {
    try {
      await updateLogo(null);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.workspace.orgUpdateError')));
    }
  }

  useRetryableFetch<Viewer | null>(
    async () => (await gqlQuery<{ viewer?: Viewer }>(VIEWER_QUERY))?.viewer ?? null,
    [],
    null,
    {
      onData: viewer => {
        if (viewer) {
          setCalendarFeedUrl(viewer.calendarFeedUrl ?? null);
          setEmailNotificationsEnabled(viewer.emailNotificationsEnabled ?? true);
          setIsPlatformAdmin(viewer.isPlatformAdmin ?? false);
        }
      },
      onError: err => toast.error(getErrorMessage(err, t('common.somethingWentWrong'))),
    },
  );

  const {
    data: apiTokenData,
    error: apiTokensError,
    refetch: reloadApiTokens,
    setData: setApiTokens,
  } = useRetryableFetch<ApiToken[]>(
    async () => (await gqlQuery<ApiToken[] | null>(API_TOKENS_QUERY, {}, 'apiTokens')) ?? [],
    [],
    [],
  );

  // Both reads read as null/empty while their error stands: `org` so the section
  // renders its load-error state rather than a stale workspace, and the token
  // list because a failed read must never render as "no API tokens yet" — an
  // admin auditing outstanding credentials would conclude there are none.
  const org = orgLoadError ? null : orgData;
  const apiTokens = apiTokensError ? [] : apiTokenData;

  async function createApiToken() {
    if (!newTokenLabel.trim()) {
      return;
    }
    setCreatingToken(true);
    try {
      const created = await gqlQuery<{ plaintext: string; token: ApiToken } | null>(
        API_TOKEN_CREATE_MUTATION,
        {
          expiresInDays: newTokenExpiryDays,
          label: newTokenLabel.trim(),
          // Read access is always granted; write is opt-in via the toggle.
          scopes: newTokenWritable ? ['read', 'write'] : ['read'],
        },
        'apiTokenCreate',
      );
      if (!created?.token) {
        toast.error(t('settings.workspace.apiTokenCreateError'));
        return;
      }
      setApiTokens(prev => [created.token, ...prev]);
      setNewPlaintext(created.plaintext);
      setNewTokenLabel('');
    } catch {
      toast.error(t('settings.workspace.apiTokenCreateError'));
    } finally {
      setCreatingToken(false);
    }
  }

  async function revokeApiToken(id: string) {
    setRevokingTokenId(id);
    try {
      await gqlMutate(API_TOKEN_REVOKE_MUTATION, { id });
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
      const rotated = await gqlQuery<{ user?: { calendarFeedUrl?: string } } | null>(
        ROTATE_CALENDAR_TOKEN_MUTATION,
        {},
        'userCalendarFeedTokenRotate',
      );
      setCalendarFeedUrl(rotated?.user?.calendarFeedUrl ?? null);
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
      await gqlMutate(UPDATE_NOTIFICATION_PREFS_MUTATION, { emailNotificationsEnabled: enabled });
    } catch {
      setEmailNotificationsEnabled(!enabled);
      toast.error(t('settings.workspace.notificationPrefsError'));
    }
  }

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

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title={t('settings.workspace.title')} />

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.organization')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            {loading ? (
              <RowsSkeleton count={2} />
            ) : org ? (
              <dl className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.logo')}
                  </dt>
                  <dd className="col-span-2 flex items-center gap-3">
                    {org.logoUrl ? (
                      <Image
                        alt={org.name}
                        className="h-10 w-10 rounded-md object-cover"
                        height={40}
                        src={org.logoUrl}
                        unoptimized
                        width={40}
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
                        {org.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    {canManageOrg && (
                      <>
                        <input
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) {
                              void uploadLogo(file);
                            }
                          }}
                          ref={logoInputRef}
                          type="file"
                        />
                        <Button
                          disabled={uploadingLogo}
                          onClick={() => logoInputRef.current?.click()}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                          {uploadingLogo
                            ? t('settings.workspace.logoUploading')
                            : t('settings.workspace.logoUpload')}
                        </Button>
                        {org.logoUrl && (
                          <Button
                            disabled={uploadingLogo}
                            onClick={() => void removeLogo()}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            {t('settings.workspace.logoRemove')}
                          </Button>
                        )}
                      </>
                    )}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.name')}
                  </dt>
                  <dd className="col-span-2">
                    {canManageOrg ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={e => {
                          e.preventDefault();
                          void saveOrgName();
                        }}
                      >
                        <Input
                          aria-label={t('settings.workspace.name')}
                          disabled={savingOrg}
                          onChange={e => setOrgName(e.target.value)}
                          value={orgName}
                        />
                        <Button
                          disabled={savingOrg || !orgName.trim() || orgName.trim() === org.name}
                          size="sm"
                          type="submit"
                        >
                          {savingOrg ? t('common.saving') : t('common.save')}
                        </Button>
                      </form>
                    ) : (
                      <span className="text-sm text-foreground">{org.name}</span>
                    )}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.urlKey')}
                  </dt>
                  <dd className="col-span-2 font-mono text-sm text-foreground-secondary">
                    {org.urlKey}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {t('settings.workspace.dataRegion')}
                  </dt>
                  <dd className="col-span-2 text-sm text-foreground-secondary capitalize">
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
              <InlineRetry
                className="py-0"
                message={t('settings.workspace.orgLoadError')}
                onRetry={() => void reloadOrg()}
              />
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('customFields.title')}
          </h2>
          <WorkspaceCustomFieldsCard canManage={canManageOrg} />
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.planLimitsTitle')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="mb-4 text-xs text-muted-foreground">
              {t('settings.workspace.planLimitsDescription')}
            </p>
            {loading ? (
              <RowsSkeleton count={2} />
            ) : org ? (
              <dl className="flex flex-col gap-4">
                {PLAN_LIMIT_FIELDS.map(({ key, labelKey }) => (
                  <div className="grid grid-cols-3 gap-4" key={key}>
                    <dt className="col-span-2 text-xs font-medium text-muted-foreground pt-0.5">
                      {t(`settings.workspace.${labelKey}`)}
                    </dt>
                    <dd className="text-right text-sm tabular-nums text-foreground">
                      {org.planLimits[key].toLocaleString(intlLocale)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <InlineRetry
                className="py-0"
                message={t('settings.workspace.orgLoadError')}
                onRetry={() => void reloadOrg()}
              />
            )}
          </div>
        </section>

        {isPlatformAdmin && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings.workspace.platform')}
            </h2>
            <Link
              className="flex items-center justify-between rounded-lg border border-brand-border bg-brand-subtle px-5 py-4 transition-colors hover:bg-brand/15"
              href="/admin"
            >
              <div>
                <p className="text-sm font-medium text-brand-subtle-foreground">
                  {t('settings.workspace.platformAdminConsole')}
                </p>
                <p className="text-xs text-brand-subtle-foreground/70">
                  {t('settings.workspace.platformAdminConsoleDescription')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-brand" />
            </Link>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.teams')}
            <span className="ml-2 font-normal normal-case text-muted-foreground">
              {teams.length}
            </span>
          </h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {teams.length === 0 ? (
              <div className="flex items-center justify-between px-5 py-4">
                <p className="text-sm text-muted-foreground">
                  {t('settings.workspace.noTeamsYet')}
                </p>
                <Button onClick={() => uiStore.openCreateTeamModal()} size="sm" type="button">
                  {t('teams.createTeam')}
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {teams.map(team => {
                  const isChild = !!team.parentId;
                  return (
                    <li
                      className={cn(isChild && 'border-l-2 border-brand-border ml-4')}
                      key={team.id}
                    >
                      <Link
                        className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50 transition-colors"
                        href={`/${workspace}/team/${team.key}/settings`}
                      >
                        {isChild && (
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-sm">
                          {team.icon ? (
                            <span>{team.icon}</span>
                          ) : (
                            <Users className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {team.displayName || team.name}
                          </p>
                          {team.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {team.description}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {team.key}
                        </span>
                        {team.private && (
                          <span className="flex items-center gap-1 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
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

        <MembersSection orgName={org?.name ?? ''} />

        {/* Personal preferences */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.myPreferences')}
          </h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {/* Language — also available in the sidebar footer, surfaced here too
                since the sidebar collapses to a drawer on small screens. */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t('language.language')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.workspace.languageDescription')}
                  </p>
                </div>
                <LanguageToggle />
              </div>
            </div>

            {/* Accent — the sidebar footer only has room for the cycling
                swatch, so the full three-option picker lives here. */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t('accent.accent')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.workspace.accentDescription')}
                  </p>
                </div>
                <AccentToggle />
              </div>
            </div>

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
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('settings.workspace.cycleCalendarFeed')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('settings.workspace.cycleCalendarFeedDescription')}
                  </p>
                  {calendarFeedUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="truncate max-w-xs text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                        {calendarFeedUrl}
                      </code>
                      <button
                        className={cn(
                          'shrink-0 text-muted-foreground hover:text-foreground',
                          TOUCH_TARGET,
                        )}
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
                    'px-3 py-1.5 text-xs font-medium text-foreground-secondary',
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
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.apiTokens')}
          </h2>
          {/* Keys are bound to the workspace they were created in, so this
              list changes when you switch. Said out loud because otherwise
              a multi-workspace user switches over and reads the empty list
              as "my keys were deleted". */}
          <p className="mb-4 text-xs text-muted-foreground">
            {t('settings.workspace.apiTokensWorkspaceScoped')}
          </p>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {/* New plaintext banner — shown only once after creation */}
            {newPlaintext && (
              <div className="px-5 py-3 bg-warning-subtle border-b border-warning/40">
                <p className="text-xs font-medium text-warning-subtle-foreground mb-1.5">
                  {t('settings.workspace.copyTokenNowWarning')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs bg-card border border-warning/40 px-2 py-1 rounded text-foreground-secondary font-mono">
                    {newPlaintext}
                  </code>
                  <button
                    className={cn(
                      'shrink-0 rounded p-1 text-warning-subtle-foreground hover:bg-warning/35',
                      TOUCH_TARGET,
                    )}
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
                  className="mt-2 text-xs text-warning-subtle-foreground hover:underline"
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
                <Key className="h-3.5 w-3.5 text-muted-foreground" />
                {t('settings.workspace.createToken')}
              </p>
              <div className="flex items-center gap-2">
                <input
                  className={cn(
                    'flex-1 rounded-md border border-border bg-transparent',
                    'px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-1 focus:ring-brand',
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
                <Button
                  className="shrink-0"
                  disabled={creatingToken || !newTokenLabel.trim()}
                  onClick={() => void createApiToken()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {creatingToken ? t('settings.workspace.creatingEllipsis') : t('common.create')}
                </Button>
              </div>
              {/* Scope + expiry controls */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  <input
                    checked={newTokenWritable}
                    className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand"
                    disabled={creatingToken}
                    onChange={e => setNewTokenWritable(e.target.checked)}
                    type="checkbox"
                  />
                  {t('settings.workspace.allowWrite')}
                </label>
                <span className="flex items-center gap-1.5">
                  {t('settings.workspace.expiresIn')}
                  <SimpleSelect
                    ariaLabel={t('settings.workspace.expiresIn')}
                    className="w-32"
                    disabled={creatingToken}
                    onChange={v => setNewTokenExpiryDays(Number(v))}
                    options={TOKEN_EXPIRY_OPTIONS.map(opt => ({
                      label: t(opt.labelKey),
                      value: String(opt.days),
                    }))}
                    value={String(newTokenExpiryDays)}
                  />
                </span>
                {!newTokenWritable && (
                  <span className="text-warning-subtle-foreground">
                    {t('settings.workspace.readOnlyKey')}
                  </span>
                )}
              </div>
            </div>

            {/* Token list */}
            {apiTokensError ? (
              <InlineRetry
                className="px-5 py-4"
                message={t('common.somethingWentWrong')}
                onRetry={() => void reloadApiTokens()}
              />
            ) : apiTokens.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                {t('settings.workspace.noApiTokensYet')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {apiTokens.map(token => (
                  <li className="flex items-start gap-3 px-5 py-3" key={token.id}>
                    <Key className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate flex items-center gap-2">
                        {token.label}
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                            token.scopes.length === 0 || token.scopes.includes('write')
                              ? 'bg-brand-subtle text-brand-subtle-foreground'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {token.scopes.length === 0 || token.scopes.includes('write')
                            ? t('settings.workspace.readWrite')
                            : t('settings.workspace.readOnly')}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
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
                      className={cn(
                        'shrink-0 text-muted-foreground hover:text-danger-subtle-foreground disabled:opacity-40',
                        TOUCH_TARGET,
                      )}
                      disabled={revokingTokenId === token.id}
                      onClick={() => setConfirmingRevokeToken(token)}
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
          <ConfirmDialog
            confirmLabel={t('settings.workspace.revokeToken')}
            message={t('settings.workspace.revokeTokenConfirm', {
              label: confirmingRevokeToken?.label ?? '',
            })}
            onCancel={() => setConfirmingRevokeToken(null)}
            onConfirm={() => {
              if (confirmingRevokeToken) {
                void revokeApiToken(confirmingRevokeToken.id);
              }
              setConfirmingRevokeToken(null);
            }}
            open={confirmingRevokeToken !== null}
            title={t('settings.workspace.revokeToken')}
          />
        </section>

        {/* AI assistant */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.workspace.ai')}
          </h2>
          <div className="rounded-lg border border-border bg-card px-5 py-4">
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
          <div className="rounded-lg border border-border bg-card overflow-hidden">
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
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
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
