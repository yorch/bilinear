'use client';

import { ArrowLeft, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type TeamMember,
  TeamMemberManagement,
} from '@/components/teams/team-member-management';
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
  mutation TeamDelete($id: ID!) {
    teamDelete(id: $id) {
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
        id owner
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

  const team = teamStore.findByKey(teamKey);

  // ── Local form state ──────────────────────────────────────────────────────
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [triageEnabled, setTriageEnabled] = useState(
    team?.triageEnabled ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Members state ─────────────────────────────────────────────────────────
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const currentUserId = userStore.currentUser?.id ?? '';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userStore.all],
  );

  // ── Danger zone ───────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync form when team loads from store
  useEffect(() => {
    if (team) {
      setName(team.name);
      setDescription(team.description ?? '');
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

        const rawMembers =
          (membersResult.data?.team as { members?: RawMembership[] })
            ?.members ?? [];

        setMembers(rawMembers.map(rawToMember));
      } catch {
        // Members will just be empty; page is still usable
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
  }, [team?.id]);

  // ── Handlers ──────────────────────────────────────────────────────────────

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
          triageEnabled,
        },
      });
      if (result.errors?.length) {
        setSaveError(gqlError(result, 'Failed to save'));
        return;
      }
      const updated = (result.data?.teamUpdate as { team?: typeof team })?.team;
      if (updated) {
        teamStore.applySyncAction('U', updated.id, updated);
      }
      toast.success('Team settings saved');
    } catch {
      setSaveError('Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  }, [team, name, description, triageEnabled, saving, teamStore]);

  const handleAddMember = useCallback(
    async (userId: string) => {
      if (!team) {
        return;
      }
      const result = await gql(MEMBERSHIP_CREATE_MUTATION, {
        input: { isOwner: false, teamId: team.id, userId },
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, 'Failed to add member'));
      }
      const raw = (
        result.data?.teamMembershipCreate as { teamMembership?: RawMembership }
      )?.teamMembership;
      if (raw) {
        setMembers(prev => [...prev, rawToMember(raw)]);
        toast.success(`${raw.user.displayName} added to team`);
      }
    },
    [team],
  );

  const handleRemoveMember = useCallback(
    async (membershipId: string) => {
      const member = members.find(m => m.membershipId === membershipId);
      const result = await gql(MEMBERSHIP_DELETE_MUTATION, {
        id: membershipId,
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, 'Failed to remove member'));
      }
      setMembers(prev => prev.filter(m => m.membershipId !== membershipId));
      // If current user removed themselves, go back to team page
      if (member?.userId === currentUserId) {
        router.push(`/${workspace}/team/${teamKey}`);
      } else {
        toast.success('Member removed');
      }
    },
    [members, currentUserId, workspace, teamKey, router],
  );

  const handleToggleOwner = useCallback(
    async (membershipId: string, isOwner: boolean) => {
      const result = await gql(MEMBERSHIP_UPDATE_MUTATION, {
        id: membershipId,
        input: { isOwner },
      });
      if (result.errors?.length) {
        throw new Error(gqlError(result, 'Failed to update role'));
      }
      setMembers(prev =>
        prev.map(m =>
          m.membershipId === membershipId ? { ...m, isOwner } : m,
        ),
      );
      toast.success(isOwner ? 'Owner role granted' : 'Owner role removed');
    },
    [],
  );

  const handleDelete = useCallback(async () => {
    if (!team || deleting) {
      return;
    }
    setDeleting(true);
    try {
      const result = await gql(TEAM_DELETE_MUTATION, { id: team.id });
      if (result.errors?.length) {
        toast.error(gqlError(result, 'Failed to delete team'));
        return;
      }
      teamStore.applySyncAction('D', team.id, null);
      router.push(`/${workspace}`);
    } finally {
      setDeleting(false);
    }
  }, [team, deleting, teamStore, router, workspace]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Team not found.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-3 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Link
          href={`/${workspace}/team/${teamKey}`}
          className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <span className="text-zinc-300 dark:text-zinc-700">/</span>
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {team.displayName || team.name} — Settings
        </h1>
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            General
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="settings-name"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Team name
              </label>
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="settings-description"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Description
              </label>
              <textarea
                id="settings-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this team work on?"
                className="resize-none rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-600 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:text-zinc-400"
              />
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Identifier
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300 rounded-md border border-zinc-200 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700">
                  {team.key}
                </span>
                <span className="text-xs text-zinc-400">
                  Used in issue IDs (e.g. {team.key}-123). Cannot be changed.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Workflow
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Triage
                </p>
                <p className="text-xs text-zinc-400">
                  New issues start in Triage and must be reviewed before
                  entering the backlog
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={triageEnabled}
                onClick={() => setTriageEnabled(v => !v)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                  triageEnabled
                    ? 'bg-indigo-600'
                    : 'bg-zinc-200 dark:bg-zinc-700',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                    triageEnabled ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </button>
            </label>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={handleSave}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
              'bg-indigo-600 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saveError && <p className="text-sm text-red-500">{saveError}</p>}
        </div>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Members
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
            {loadingMembers ? (
              <div className="flex items-center justify-center py-6 text-sm text-zinc-400">
                Loading members…
              </div>
            ) : (
              <TeamMemberManagement
                members={members}
                orgUsers={orgUsers}
                currentUserId={currentUserId}
                onAddMember={handleAddMember}
                onRemoveMember={handleRemoveMember}
                onToggleOwner={handleToggleOwner}
              />
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-red-400">
            Danger Zone
          </h2>
          <div className="rounded-lg border border-red-200 bg-white p-5 dark:border-red-900/50 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Delete team
                </p>
                <p className="text-xs text-zinc-400">
                  Permanently deletes the team and all its issues. This cannot
                  be undone.
                </p>
              </div>
              {deleteConfirm ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-zinc-500">Are you sure?</span>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleDelete}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete team
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
});

export default TeamSettingsPage;
