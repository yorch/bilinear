'use client';

import { ArrowLeft, Info, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section';
import { IssueTemplatesSection } from '@/components/issues/issue-templates-section';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionHeader } from '@/components/shared/section-header';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { TeamLabelsSection } from '@/components/teams/team-labels-section';
import {
  type TeamMember,
  TeamMemberManagement,
  type TeamRole,
} from '@/components/teams/team-member-management';
import {
  AutoCloseCard,
  CyclesCard,
  DefaultStateField,
  EstimationCard,
  TeamIdentityFields,
} from '@/components/teams/team-settings-cards';
import {
  type EstimationType,
  readTeamExtras,
  type TeamNumberField,
  validateTeamNumbers,
} from '@/components/teams/team-settings-helpers';
import { TeamWorkflowSection } from '@/components/teams/team-workflow-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage, gqlError } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const TEAM_MEMBERS_QUERY = `
  query TeamMembers($id: ID!) {
    team(id: $id) {
      members {
        id
        owner
        role
        user {
          id displayName email initials avatarUrl avatarBackgroundColor
        }
      }
    }
  }
`;

const TEAM_UPDATE_MUTATION = `
  mutation TeamUpdate($id: ID!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      success
      lastSyncId
      team {
        id organizationId parentId
        key name displayName description icon color private timezone
        cyclesEnabled cycleDuration cycleStartDay cycleCooldownTime
        autoClosePeriod autoArchivePeriod autoCloseChildIssues autoCloseParentIssues
        defaultIssueStateId issueEstimationType triageEnabled issueCount
        createdAt updatedAt archivedAt
      }
    }
  }
`;

const TEAM_DELETE_MUTATION = `
  mutation TeamDelete($id: ID!, $input: TeamDeleteInput!) {
    teamDelete(id: $id, input: $input) {
      success
      lastSyncId
    }
  }
`;

const MEMBERSHIP_CREATE_MUTATION = `
  mutation TeamMembershipCreate($input: TeamMembershipCreateInput!) {
    teamMembershipCreate(input: $input) {
      success
      teamMembership {
        id owner
        user {
          id displayName email initials avatarUrl avatarBackgroundColor
        }
      }
    }
  }
`;

const MEMBERSHIP_DELETE_MUTATION = `
  mutation TeamMembershipDelete($id: ID!) {
    teamMembershipDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

const MEMBERSHIP_UPDATE_MUTATION = `
  mutation TeamMembershipUpdate($id: ID!, $input: TeamMembershipUpdateInput!) {
    teamMembershipUpdate(id: $id, input: $input) {
      success
      teamMembership {
        id owner role
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawMembership {
  id: string;
  owner: boolean;
  role?: string;
  user: {
    id: string;
    displayName: string;
    email: string;
    initials: string;
    avatarUrl?: string | null;
    avatarBackgroundColor: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawToMember(m: RawMembership): TeamMember {
  return {
    avatarBackgroundColor: m.user.avatarBackgroundColor,
    avatarUrl: m.user.avatarUrl,
    displayName: m.user.displayName,
    email: m.user.email,
    initials: m.user.initials,
    isOwner: m.owner,
    membershipId: m.id,
    role: (m.role as TeamMember['role']) ?? 'member',
    userId: m.user.id,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TeamSettingsPage = observer(function TeamSettingsPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const router = useRouter();
  const {
    issueStore,
    organizationMemberStore,
    syncStore,
    teamStore,
    userStore,
    workflowStateStore,
  } = useStore();
  const t = useTranslations();

  const team = teamStore.findByKey(teamKey);

  useDocumentTitle(
    team ? t('settings.team.settingsHeading', { name: team.displayName || team.name }) : null,
  );

  // ── Local form state ──────────────────────────────────────────────────────
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [isPrivate, setIsPrivate] = useState(team?.private ?? false);
  const [parentId, setParentId] = useState(team?.parentId ?? '');
  const [triageEnabled, setTriageEnabled] = useState(team?.triageEnabled ?? false);
  const [icon, setIcon] = useState(team?.icon ?? '');
  const [color, setColor] = useState(team?.color ?? '');
  const [timezone, setTimezone] = useState(team?.timezone ?? 'UTC');
  const [estimationType, setEstimationType] = useState<EstimationType>(
    (team?.issueEstimationType as EstimationType | undefined) ?? 'notUsed',
  );
  const [cyclesEnabled, setCyclesEnabled] = useState(team?.cyclesEnabled ?? false);
  const [cycleDuration, setCycleDuration] = useState('2');
  const [cycleStartDay, setCycleStartDay] = useState(1);
  const [cycleCooldownTime, setCycleCooldownTime] = useState('0');
  const [autoClosePeriod, setAutoClosePeriod] = useState('');
  const [autoArchivePeriod, setAutoArchivePeriod] = useState('');
  const [autoCloseChildIssues, setAutoCloseChildIssues] = useState(false);
  const [autoCloseParentIssues, setAutoCloseParentIssues] = useState(false);
  const [defaultIssueStateId, setDefaultIssueStateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [numberErrors, setNumberErrors] = useState<Partial<Record<TeamNumberField, true>>>({});

  // ── Members state ─────────────────────────────────────────────────────────
  const currentUserId = userStore.currentUser?.id ?? '';
  // Keyed on the `all` computed, NOT `pool.size`. MobX caches a computed while it
  // is observed, so its array identity changes exactly when the underlying rows
  // change — including a rename, which replaces a row without changing the key
  // count. `pool.size` would hold this list stale until someone joins or leaves.
  const orgUsers = useMemo(
    () =>
      userStore.all.map(u => ({
        avatarBackgroundColor: u.avatarBgColor,
        avatarUrl: u.avatarUrl ?? null,
        displayName: u.displayName,
        email: u.email,
        id: u.id,
        initials: u.initials,
      })),
    [userStore.all],
  );

  // ── Danger zone ───────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // No default: the destructive option must be an explicit choice, never the
  // one a quick click lands on.
  const [issueAction, setIssueAction] = useState<'DELETE' | 'MOVE' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moveToTeamId, setMoveToTeamId] = useState('');

  const otherTeams = teamStore.all.filter(t => t.id !== team?.id && !t.archivedAt);

  // Seed the draft from the store row. Also what "Discard" does.
  const resetForm = useCallback(() => {
    if (!team) {
      return;
    }
    setName(team.name);
    setDescription(team.description ?? '');
    setIsPrivate(team.private ?? false);
    setParentId(team.parentId ?? '');
    setTriageEnabled(team.triageEnabled);
    setIcon(team.icon ?? '');
    setColor(team.color ?? '');
    setTimezone(team.timezone || 'UTC');
    setEstimationType((team.issueEstimationType as EstimationType) || 'notUsed');
    setCyclesEnabled(team.cyclesEnabled);
    const extras = readTeamExtras(team);
    setCycleDuration(String(extras.cycleDuration));
    setCycleStartDay(extras.cycleStartDay);
    setCycleCooldownTime(String(extras.cycleCooldownTime));
    setAutoClosePeriod(extras.autoClosePeriod === null ? '' : String(extras.autoClosePeriod));
    setAutoArchivePeriod(extras.autoArchivePeriod === null ? '' : String(extras.autoArchivePeriod));
    setAutoCloseChildIssues(extras.autoCloseChildIssues);
    setAutoCloseParentIssues(extras.autoCloseParentIssues);
    setDefaultIssueStateId(extras.defaultIssueStateId ?? '');
    setNumberErrors({});
    setSaveError('');
  }, [team]);

  // Sync form when team loads from (or changes in) the store
  useEffect(() => {
    resetForm();
  }, [resetForm]);

  // The same fields as a comparable snapshot, so the page knows whether there
  // is anything unsaved to offer Save / Discard for.
  const draftSnapshot = JSON.stringify([
    name,
    description,
    isPrivate,
    parentId,
    triageEnabled,
    icon,
    color,
    timezone,
    estimationType,
    cyclesEnabled,
    cycleDuration,
    cycleStartDay,
    cycleCooldownTime,
    autoClosePeriod,
    autoArchivePeriod,
    autoCloseChildIssues,
    autoCloseParentIssues,
    defaultIssueStateId,
  ]);
  const savedSnapshot = useMemo(() => {
    if (!team) {
      return '';
    }
    const extras = readTeamExtras(team);
    return JSON.stringify([
      team.name,
      team.description ?? '',
      team.private ?? false,
      team.parentId ?? '',
      team.triageEnabled,
      team.icon ?? '',
      team.color ?? '',
      team.timezone || 'UTC',
      (team.issueEstimationType as EstimationType) || 'notUsed',
      team.cyclesEnabled,
      String(extras.cycleDuration),
      extras.cycleStartDay,
      String(extras.cycleCooldownTime),
      extras.autoClosePeriod === null ? '' : String(extras.autoClosePeriod),
      extras.autoArchivePeriod === null ? '' : String(extras.autoArchivePeriod),
      extras.autoCloseChildIssues,
      extras.autoCloseParentIssues,
      extras.defaultIssueStateId ?? '',
    ]);
  }, [team]);
  const dirty = !!team && draftSnapshot !== savedSnapshot;

  // A browser-level guard for the one thing the page can lose: an unsaved draft.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Load team members
  const teamId = team?.id;
  const {
    data: memberData,
    error: membersError,
    loading: membersLoading,
    refetch: reloadMembers,
    setData: setMembers,
  } = useRetryableFetch<TeamMember[]>(
    async () => {
      if (!teamId) {
        return [];
      }
      const data = await gqlMutate(TEAM_MEMBERS_QUERY, { id: teamId });
      const raw = (data.team as { members?: RawMembership[] } | undefined)?.members ?? [];
      return raw.map(rawToMember);
    },
    [teamId],
    [],
    { onError: err => toast.error(getErrorMessage(err, t('settings.team.loadMembersError'))) },
  );

  // A failed read must not render as an empty roster — that reads as "this team
  // has no members" to whoever is auditing who has access.
  const members = membersError ? [] : memberData;
  // The team itself arrives from the store, which may not have hydrated yet.
  // Keep showing the loading row until it has, rather than briefly claiming the
  // team has no members.
  const loadingMembers = membersLoading || !teamId;

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Parent team options — exclude self and own descendants to prevent cycles
  const parentTeamOptions = teamStore.all.filter(
    t => t.id !== team?.id && !t.parentId && !t.archivedAt,
  );

  const handleSave = useCallback(async () => {
    if (!team || saving) {
      return;
    }
    const { errors, values } = validateTeamNumbers({
      autoArchivePeriod,
      autoClosePeriod,
      cycleCooldownTime,
      cycleDuration,
      cyclesEnabled,
    });
    setNumberErrors(errors);
    if (!values) {
      setSaveError(t('settings.team.fixHighlightedFields'));
      // Bring the first bad field into view and focus it.
      const order: Array<[TeamNumberField, string]> = [
        ['cycleDuration', 'settings-cycle-duration'],
        ['cycleCooldownTime', 'settings-cycle-cooldown'],
        ['autoClosePeriod', 'settings-auto-close'],
        ['autoArchivePeriod', 'settings-auto-archive'],
      ];
      const first = order.find(([field]) => errors[field]);
      if (first) {
        const el = document.getElementById(first[1]);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus({ preventScroll: true });
      }
      return;
    }
    const enablingCycles = cyclesEnabled && !team.cyclesEnabled;
    setSaving(true);
    setSaveError('');
    try {
      const result = await gql(TEAM_UPDATE_MUTATION, {
        id: team.id,
        input: {
          autoArchivePeriod: values.autoArchivePeriod,
          autoCloseChildIssues,
          autoCloseParentIssues,
          autoClosePeriod: values.autoClosePeriod,
          color: color || null,
          cycleCooldownTime: cyclesEnabled ? values.cycleCooldownTime : undefined,
          cycleDuration: cyclesEnabled ? (values.cycleDuration ?? undefined) : undefined,
          cycleStartDay: cyclesEnabled ? cycleStartDay : undefined,
          cyclesEnabled,
          defaultIssueStateId: defaultIssueStateId || null,
          description: description.trim() || null,
          icon: icon.trim() || null,
          issueEstimationType: estimationType,
          name: name.trim(),
          parentId: parentId || null,
          private: isPrivate,
          timezone,
          triageEnabled,
        },
      });
      if (result.errors?.length) {
        const message = gqlError(result, t('settings.team.saveError'));
        setSaveError(message);
        // A validation refusal carries the server's own explanation (which
        // knob, which range) — surface it where the user is looking.
        const code = (result.errors[0] as { extensions?: { code?: string } })?.extensions?.code;
        if (code === 'BAD_USER_INPUT') {
          toast.error(message);
        }
        return;
      }
      const updated = (result.data?.teamUpdate as { team?: typeof team })?.team;
      if (updated) {
        teamStore.applySyncAction('U', updated.id, updated);
      }
      toast.success(t('settings.team.settingsSaved'));
      if (enablingCycles) {
        toast.info(t('settings.team.cycles.enabledToast'));
      }
    } catch {
      setSaveError(t('settings.team.saveErrorRetry'));
    } finally {
      setSaving(false);
    }
  }, [
    team,
    name,
    description,
    isPrivate,
    parentId,
    triageEnabled,
    icon,
    color,
    timezone,
    estimationType,
    cyclesEnabled,
    cycleDuration,
    cycleStartDay,
    cycleCooldownTime,
    autoClosePeriod,
    autoArchivePeriod,
    autoCloseChildIssues,
    autoCloseParentIssues,
    defaultIssueStateId,
    saving,
    teamStore,
    t,
  ]);

  const handleAddMember = useCallback(
    async (userId: string) => {
      if (!team) {
        return;
      }
      const result = await gql(MEMBERSHIP_CREATE_MUTATION, {
        input: { isOwner: false, teamId: team.id, userId },
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, t('settings.team.addMemberError')));
      }
      const raw = (result.data?.teamMembershipCreate as { teamMembership?: RawMembership })
        ?.teamMembership;
      if (raw) {
        setMembers(prev => [...prev, rawToMember(raw)]);
        toast.success(t('settings.team.memberAdded', { name: raw.user.displayName }));
      }
    },
    [team, setMembers, t],
  );

  const handleRemoveMember = useCallback(
    async (membershipId: string) => {
      const member = members.find(m => m.membershipId === membershipId);
      const result = await gql(MEMBERSHIP_DELETE_MUTATION, {
        id: membershipId,
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, t('settings.team.removeMemberError')));
      }
      setMembers(prev => prev.filter(m => m.membershipId !== membershipId));
      // If current user removed themselves, go back to team page
      if (member?.userId === currentUserId) {
        router.push(`/${workspace}/team/${teamKey}`);
      } else {
        toast.success(t('settings.team.memberRemoved'));
      }
    },
    [members, currentUserId, workspace, teamKey, router, setMembers, t],
  );

  const handleToggleOwner = useCallback(
    async (membershipId: string, isOwner: boolean) => {
      const result = await gql(MEMBERSHIP_UPDATE_MUTATION, {
        id: membershipId,
        input: { isOwner },
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, t('settings.team.updateRoleError')));
      }
      setMembers(prev => prev.map(m => (m.membershipId === membershipId ? { ...m, isOwner } : m)));
      toast.success(
        isOwner ? t('settings.team.ownerRoleGranted') : t('settings.team.ownerRoleRemoved'),
      );
    },
    [setMembers, t],
  );

  const handleUpdateRole = useCallback(
    async (membershipId: string, role: TeamRole) => {
      const result = await gql(MEMBERSHIP_UPDATE_MUTATION, {
        id: membershipId,
        input: { role },
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, t('settings.team.updateRoleError')));
      }
      setMembers(prev => prev.map(m => (m.membershipId === membershipId ? { ...m, role } : m)));
      toast.success(t('settings.team.roleUpdated'));
    },
    [setMembers, t],
  );

  const handleDelete = useCallback(async () => {
    if (!team || deleting || !issueAction) {
      return;
    }
    if (issueAction === 'MOVE' && !moveToTeamId) {
      toast.error(t('settings.team.selectTeamToMoveIssues'));
      return;
    }
    setDeleting(true);
    try {
      const input: { issueAction: string; moveToTeamId?: string } = {
        issueAction,
      };
      if (issueAction === 'MOVE') {
        input.moveToTeamId = moveToTeamId;
      }
      const result = await gql(TEAM_DELETE_MUTATION, {
        id: team.id,
        input,
      });
      if (result.errors?.length) {
        toast.error(gqlError(result, t('settings.team.deleteTeamError')));
        return;
      }
      teamStore.applySyncAction('D', team.id, null);
      router.push(`/${workspace}`);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.team.deleteTeamError')));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [team, deleting, issueAction, moveToTeamId, teamStore, router, workspace, t]);

  // ── Permissions (mirrors the server) ─────────────────────────────────────
  // teamUpdate: org owner/admin, or a non-guest team owner. teamDelete: org
  // owner/admin only. Until the roster and roles resolve we assume editable so
  // the page doesn't flash read-only for people who can edit.
  const viewerOrgRole = currentUserId
    ? organizationMemberStore.rolesByUserId[currentUserId]
    : undefined;
  const isOrgAdmin = viewerOrgRole === 'owner' || viewerOrgRole === 'admin';
  const hydrated = syncStore.status !== 'idle' && syncStore.status !== 'bootstrapping';
  const myMembership = members.find(m => m.userId === currentUserId);
  const rolesResolved = hydrated && !membersLoading && !membersError;
  const canEdit =
    !rolesResolved || isOrgAdmin || (!!myMembership?.isOwner && myMembership.role !== 'guest');
  const canDelete = isOrgAdmin;

  // ── Render ────────────────────────────────────────────────────────────────

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('settings.team.notFound')}
      </div>
    );
  }

  const SECTION_NAV = [
    { id: 'team-general', label: t('settings.team.general') },
    { id: 'team-workflow', label: t('settings.team.workflow') },
    { id: 'team-members', label: t('settings.team.members') },
    { id: 'team-states', label: t('settings.team.navStates') },
    { id: 'team-labels', label: t('settings.team.navLabels') },
    { id: 'team-fields', label: t('settings.team.navFields') },
    { id: 'team-templates', label: t('settings.team.navTemplates') },
    ...(canDelete ? [{ id: 'team-danger', label: t('settings.team.dangerZone') }] : []),
  ];

  // Live issues on the team, from the store. `team.issueCount` is the
  // issue-NUMBER counter (every issue ever created, incl. archived/moved) and
  // is stale in the store, so it produced "Delete team and 0 issues" for a team
  // that had one.
  const liveIssueCount = issueStore.findByTeamId(team.id).length;

  const deleteConfirmLabel =
    issueAction === 'MOVE'
      ? t('settings.team.deleteTeamMoveIssuesConfirm', { count: liveIssueCount })
      : t('settings.team.deleteTeamDeleteIssuesConfirm', { count: liveIssueCount });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        leading={
          <>
            <Link
              className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              href={`/${workspace}/team/${teamKey}`}
            >
              <ArrowLeft className="h-4 w-4" />
              {t('settings.team.back')}
            </Link>
            <span className="text-foreground-faint">/</span>
          </>
        }
        title={t('settings.team.settingsHeading', { name: team.displayName || team.name })}
      />

      {/* In-page navigation: eleven stacked sections and no other landmarks. */}
      <nav
        aria-label={t('settings.team.sections')}
        className="sticky top-0 z-10 shrink-0 overflow-x-auto border-b border-border bg-background/95 backdrop-blur"
      >
        <ul className="mx-auto flex w-full max-w-2xl gap-1 px-4 py-1.5 md:px-6">
          {SECTION_NAV.map(item => (
            <li className="shrink-0" key={item.id}>
              <a
                className="flex items-center rounded-md px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground max-md:min-h-11"
                href={`#${item.id}`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
        {!canEdit && (
          <div
            className="flex items-start gap-2 rounded-lg border border-info/40 bg-info-subtle px-4 py-3 text-info-subtle-foreground text-sm"
            role="status"
          >
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {t('settings.team.readOnlyNotice')}
          </div>
        )}

        {/* Everything below is one disabled group for people the server would
            refuse: controls stay visible but inert instead of failing on submit. */}
        <fieldset className="m-0 flex min-w-0 flex-col gap-8 border-0 p-0" disabled={!canEdit}>
          <section className="scroll-mt-14" id="team-general">
            <div className="mb-4">
              <SectionHeader as="h2" title={t('settings.team.general')} />
            </div>
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 md:p-5">
              <div className="flex flex-col gap-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="settings-name"
                >
                  {t('settings.team.teamName')}
                </label>
                <Input id="settings-name" onChange={e => setName(e.target.value)} value={name} />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="settings-description"
                >
                  {t('settings.team.description')}
                </label>
                <Textarea
                  className="resize-none"
                  id="settings-description"
                  onChange={e => setDescription(e.target.value)}
                  placeholder={t('settings.team.descriptionPlaceholder')}
                  rows={2}
                  value={description}
                />
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('settings.team.identifier')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm text-foreground-secondary">
                    {team.key}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('settings.team.identifierHint', { key: team.key })}
                  </span>
                </div>
              </div>

              {/* Parent team */}
              <div className="flex flex-col gap-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="settings-parent"
                >
                  {t('settings.team.parentTeam')}
                </label>
                <SimpleSelect
                  id="settings-parent"
                  onChange={setParentId}
                  options={[
                    { label: t('settings.team.noParentTeam'), value: '' },
                    ...parentTeamOptions.map(pt => ({
                      label: `${pt.displayName || pt.name} (${pt.key})`,
                      value: pt.id,
                    })),
                  ]}
                  value={parentId}
                />
                <p className="text-xs text-muted-foreground">{t('settings.team.parentTeamHint')}</p>
              </div>

              <TeamIdentityFields
                color={color}
                icon={icon}
                onColorChange={setColor}
                onIconChange={setIcon}
                onTimezoneChange={setTimezone}
                timezone={timezone}
              />
            </div>
          </section>

          <EstimationCard onChange={setEstimationType} value={estimationType} />

          <CyclesCard
            cycleCooldownTime={cycleCooldownTime}
            cycleDuration={cycleDuration}
            cycleStartDay={cycleStartDay}
            cyclesEnabled={cyclesEnabled}
            errors={numberErrors}
            onCycleCooldownTimeChange={setCycleCooldownTime}
            onCycleDurationChange={setCycleDuration}
            onCycleStartDayChange={setCycleStartDay}
            onCyclesEnabledChange={setCyclesEnabled}
          />

          <AutoCloseCard
            autoArchivePeriod={autoArchivePeriod}
            autoCloseChildIssues={autoCloseChildIssues}
            autoCloseParentIssues={autoCloseParentIssues}
            autoClosePeriod={autoClosePeriod}
            errors={numberErrors}
            onAutoArchivePeriodChange={setAutoArchivePeriod}
            onAutoCloseChildIssuesChange={setAutoCloseChildIssues}
            onAutoCloseParentIssuesChange={setAutoCloseParentIssues}
            onAutoClosePeriodChange={setAutoClosePeriod}
          />

          <section className="scroll-mt-14" id="team-workflow">
            <div className="mb-4">
              <SectionHeader as="h2" title={t('settings.team.workflow')} />
            </div>
            <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 md:p-5">
              {/* Private team toggle */}
              <SettingToggleRow
                checked={isPrivate}
                description={t('settings.team.privateTeamDescription')}
                label={t('settings.team.privateTeam')}
                onCheckedChange={setIsPrivate}
              />

              {/* Triage toggle */}
              <SettingToggleRow
                checked={triageEnabled}
                description={t('settings.team.triageDescription')}
                label={t('settings.team.triage')}
                onCheckedChange={setTriageEnabled}
              />

              <DefaultStateField
                onChange={setDefaultIssueStateId}
                states={workflowStateStore.findByTeamId(team.id)}
                value={defaultIssueStateId}
              />
            </div>
          </section>

          <section className="scroll-mt-14" id="team-members">
            <div className="mb-4">
              <SectionHeader as="h2" title={t('settings.team.members')} />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.team.membersSaveNote')}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 md:p-5">
              {loadingMembers ? (
                <RowsSkeleton count={3} />
              ) : membersError ? (
                <InlineRetry
                  className="py-0"
                  message={t('settings.team.loadMembersError')}
                  onRetry={() => void reloadMembers()}
                />
              ) : (
                <TeamMemberManagement
                  currentUserId={currentUserId}
                  members={members}
                  onAddMember={handleAddMember}
                  onRemoveMember={handleRemoveMember}
                  onToggleOwner={handleToggleOwner}
                  onUpdateRole={handleUpdateRole}
                  orgUsers={orgUsers}
                />
              )}
            </div>
          </section>

          <div className="scroll-mt-14" id="team-states">
            <TeamWorkflowSection defaultStateId={defaultIssueStateId || null} teamId={team.id} />
          </div>

          <div className="scroll-mt-14" id="team-labels">
            <TeamLabelsSection teamId={team.id} />
          </div>

          <div className="scroll-mt-14" id="team-fields">
            <CustomFieldsSection teamId={team.id} />
          </div>

          <div className="scroll-mt-14" id="team-templates">
            <IssueTemplatesSection teamId={team.id} />
          </div>
        </fieldset>

        {canDelete && (
          <section className="scroll-mt-14" id="team-danger">
            <h2 className="mb-4 font-semibold text-danger-subtle-foreground text-xs uppercase tracking-wider">
              {t('settings.team.dangerZone')}
            </h2>
            <div className="rounded-lg border border-danger/40 bg-card p-4 md:p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground-secondary text-sm">
                      {t('settings.team.deleteTeam')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('settings.team.deleteTeamHint', { count: liveIssueCount })}
                    </p>
                  </div>
                  {!deleteConfirm && (
                    <Button
                      className="shrink-0 border-danger/40 text-danger-subtle-foreground hover:bg-danger-subtle"
                      onClick={() => setDeleteConfirm(true)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('settings.team.deleteTeam')}
                    </Button>
                  )}
                </div>

                {deleteConfirm && (
                  <fieldset className="m-0 flex flex-col gap-3 rounded-md border border-danger/40 bg-danger-subtle/50 p-4">
                    <legend className="px-1 font-medium text-muted-foreground text-xs">
                      {t('settings.team.whatShouldHappenToIssues')}
                    </legend>

                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        checked={issueAction === 'MOVE'}
                        className="mt-0.5 accent-brand"
                        disabled={otherTeams.length === 0}
                        name="issueAction"
                        onChange={() => setIssueAction('MOVE')}
                        type="radio"
                        value="MOVE"
                      />
                      <div className="flex-1">
                        <p className="text-foreground-secondary text-sm">
                          {t('settings.team.moveIssuesToAnotherTeam')}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t('settings.team.moveIssuesHint')}
                        </p>
                      </div>
                    </label>

                    {issueAction === 'MOVE' && otherTeams.length > 0 && (
                      <SimpleSelect
                        className="ml-6"
                        onChange={setMoveToTeamId}
                        options={otherTeams.map(ot => ({
                          label: `${ot.displayName || ot.name} (${ot.key})`,
                          value: ot.id,
                        }))}
                        placeholder={t('settings.team.selectATeam')}
                        placement="top"
                        value={moveToTeamId}
                      />
                    )}

                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        checked={issueAction === 'DELETE'}
                        className="mt-0.5 accent-danger"
                        name="issueAction"
                        onChange={() => setIssueAction('DELETE')}
                        type="radio"
                        value="DELETE"
                      />
                      <div>
                        <p className="text-foreground-secondary text-sm">
                          {t('settings.team.deleteAllIssues')}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t('settings.team.deleteAllIssuesHint')}
                        </p>
                      </div>
                    </label>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        onClick={() => {
                          setDeleteConfirm(false);
                          setIssueAction(null);
                          setMoveToTeamId('');
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        disabled={
                          deleting || !issueAction || (issueAction === 'MOVE' && !moveToTeamId)
                        }
                        onClick={() => setConfirmingDelete(true)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {deleting
                          ? t('settings.team.deletingEllipsis')
                          : t('settings.team.deleteTeam')}
                      </Button>
                    </div>
                  </fieldset>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Sticky save bar: the one Save for everything in the form above. It
          appears only while there is something unsaved, with Discard beside it.
          Members, workflow states, labels, fields and templates save instantly
          on their own and are not part of this bar. */}
      {canEdit && (dirty || saveError) && (
        <div className="sticky bottom-0 z-20 shrink-0 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <p className="min-w-0 flex-1 text-sm" role="status">
              {saveError ? (
                <span className="text-danger-subtle-foreground">{saveError}</span>
              ) : (
                <span className="text-muted-foreground">{t('settings.team.unsavedChanges')}</span>
              )}
            </p>
            <Button
              disabled={saving || !dirty}
              onClick={() => {
                resetForm();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t('settings.team.discard')}
            </Button>
            <Button
              disabled={saving || !name.trim() || !dirty}
              onClick={handleSave}
              size="sm"
              type="button"
            >
              {saving ? t('common.saving') : t('settings.team.saveChanges')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        confirmDisabled={deleting}
        confirmLabel={deleteConfirmLabel}
        message={
          issueAction === 'MOVE'
            ? t('settings.team.deleteTeamConfirmMove', {
                count: liveIssueCount,
                name: team.displayName || team.name,
              })
            : t('settings.team.deleteTeamConfirmDelete', {
                count: liveIssueCount,
                name: team.displayName || team.name,
              })
        }
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        open={confirmingDelete}
        requireText={team.key}
        title={t('settings.team.deleteTeam')}
      />
    </div>
  );
});

export default TeamSettingsPage;
