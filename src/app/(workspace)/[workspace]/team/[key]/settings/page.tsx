'use client';

import { ArrowLeft, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section';
import { IssueTemplatesSection } from '@/components/issues/issue-templates-section';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import {
  type TeamMember,
  TeamMemberManagement,
  type TeamRole,
} from '@/components/teams/team-member-management';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, gqlError } from '@/lib/utils';
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
        cyclesEnabled issueEstimationType triageEnabled issueCount
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
  const { teamStore, userStore } = useStore();
  const t = useTranslations();

  const team = teamStore.findByKey(teamKey);

  // ── Local form state ──────────────────────────────────────────────────────
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [isPrivate, setIsPrivate] = useState(team?.private ?? false);
  const [parentId, setParentId] = useState(team?.parentId ?? '');
  const [triageEnabled, setTriageEnabled] = useState(team?.triageEnabled ?? false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Members state ─────────────────────────────────────────────────────────
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const currentUserId = userStore.currentUser?.id ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
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
    [userStore.pool.size],
  );

  // ── Danger zone ───────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [issueAction, setIssueAction] = useState<'DELETE' | 'MOVE'>('DELETE');
  const [moveToTeamId, setMoveToTeamId] = useState('');

  const otherTeams = teamStore.all.filter(t => t.id !== team?.id && !t.archivedAt);

  // Sync form when team loads from store
  useEffect(() => {
    if (team) {
      setName(team.name);
      setDescription(team.description ?? '');
      setIsPrivate(team.private ?? false);
      setParentId(team.parentId ?? '');
      setTriageEnabled(team.triageEnabled);
    }
  }, [team]);

  // Load team members
  useEffect(() => {
    if (!team?.id) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const membersResult = await gql(TEAM_MEMBERS_QUERY, { id: team.id });

        if (cancelled) {
          return;
        }

        if (membersResult.errors?.length) {
          toast.error(gqlError(membersResult, t('settings.team.loadMembersError')));
          return;
        }

        const rawMembers =
          (membersResult.data?.team as { members?: RawMembership[] })?.members ?? [];

        setMembers(rawMembers.map(rawToMember));
      } catch {
        toast.error(t('settings.team.loadMembersError'));
      } finally {
        if (!cancelled) {
          setLoadingMembers(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [team?.id, t]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Parent team options — exclude self and own descendants to prevent cycles
  const parentTeamOptions = teamStore.all.filter(
    t => t.id !== team?.id && !t.parentId && !t.archivedAt,
  );

  const handleSave = useCallback(async () => {
    if (!team || saving) {
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const result = await gql(TEAM_UPDATE_MUTATION, {
        id: team.id,
        input: {
          description: description.trim() || null,
          name: name.trim(),
          parentId: parentId || null,
          private: isPrivate,
          triageEnabled,
        },
      });
      if (result.errors?.length) {
        setSaveError(gqlError(result, t('settings.team.saveError')));
        return;
      }
      const updated = (result.data?.teamUpdate as { team?: typeof team })?.team;
      if (updated) {
        teamStore.applySyncAction('U', updated.id, updated);
      }
      toast.success(t('settings.team.settingsSaved'));
    } catch {
      setSaveError(t('settings.team.saveErrorRetry'));
    } finally {
      setSaving(false);
    }
  }, [team, name, description, isPrivate, parentId, triageEnabled, saving, teamStore, t]);

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
    [team, t],
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
    [members, currentUserId, workspace, teamKey, router, t],
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
    [t],
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
    [t],
  );

  const handleDelete = useCallback(async () => {
    if (!team || deleting) {
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
    } finally {
      setDeleting(false);
    }
  }, [team, deleting, issueAction, moveToTeamId, teamStore, router, workspace, t]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('settings.team.notFound')}
      </div>
    );
  }

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

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.team.general')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="settings-name">
                {t('settings.team.teamName')}
              </label>
              <input
                className="rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                id="settings-name"
                onChange={e => setName(e.target.value)}
                type="text"
                value={name}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="settings-description"
              >
                {t('settings.team.description')}
              </label>
              <textarea
                className="resize-none rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-muted-foreground placeholder:text-muted-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
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
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-foreground-secondary rounded-md border border-border px-3 py-1.5 bg-card">
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
              <select
                className="rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:bg-card"
                id="settings-parent"
                onChange={e => setParentId(e.target.value)}
                value={parentId}
              >
                <option value="">{t('settings.team.noParentTeam')}</option>
                {parentTeamOptions.map(pt => (
                  <option key={pt.id} value={pt.id}>
                    {pt.displayName || pt.name} ({pt.key})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t('settings.team.parentTeamHint')}</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.team.workflow')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-5">
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
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
              'bg-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
            )}
            disabled={saving || !name.trim()}
            onClick={handleSave}
            type="button"
          >
            {saving ? t('common.saving') : t('settings.team.saveChanges')}
          </button>
          {saveError && <p className="text-sm text-danger-subtle-foreground">{saveError}</p>}
        </div>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.team.members')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            {loadingMembers ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                {t('settings.team.loadingMembers')}
              </div>
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

        <CustomFieldsSection teamId={team.id} />

        <IssueTemplatesSection teamId={team.id} />

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-danger-subtle-foreground">
            {t('settings.team.dangerZone')}
          </h2>
          <div className="rounded-lg border border-danger/40 bg-card p-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground-secondary">
                    {t('settings.team.deleteTeam')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.team.deleteTeamHint', { count: team.issueCount })}
                  </p>
                </div>
                {!deleteConfirm && (
                  <button
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-sm text-danger-subtle-foreground transition-colors hover:bg-danger-subtle"
                    onClick={() => setDeleteConfirm(true)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('settings.team.deleteTeam')}
                  </button>
                )}
              </div>

              {deleteConfirm && (
                <div className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger-subtle/50 p-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('settings.team.whatShouldHappenToIssues')}
                  </p>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      checked={issueAction === 'DELETE'}
                      className="mt-0.5 accent-danger"
                      name="issueAction"
                      onChange={() => setIssueAction('DELETE')}
                      type="radio"
                      value="DELETE"
                    />
                    <div>
                      <p className="text-sm text-foreground-secondary">
                        {t('settings.team.deleteAllIssues')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.team.deleteAllIssuesHint')}
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      'flex items-start gap-2',
                      otherTeams.length > 0 ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <input
                      checked={issueAction === 'MOVE'}
                      className="mt-0.5 accent-danger"
                      disabled={otherTeams.length === 0}
                      name="issueAction"
                      onChange={() => setIssueAction('MOVE')}
                      type="radio"
                      value="MOVE"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-foreground-secondary">
                        {t('settings.team.moveIssuesToAnotherTeam')}
                      </p>
                      <p className="text-xs text-muted-foreground">
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

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                      onClick={() => {
                        setDeleteConfirm(false);
                        setIssueAction('DELETE');
                        setMoveToTeamId('');
                      }}
                      type="button"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={deleting || (issueAction === 'MOVE' && !moveToTeamId)}
                      onClick={handleDelete}
                      type="button"
                    >
                      {deleting
                        ? t('settings.team.deletingEllipsis')
                        : t('settings.team.deleteTeam')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
});

export default TeamSettingsPage;
