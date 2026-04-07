'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { IssueDetailPanel } from '@/components/issues/issue-detail-panel';
import { IssueListView } from '@/components/issues/issue-list-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import { useChord, useHotkeys } from '@/hooks/use-hotkeys';
import { useRecentItems } from '@/hooks/use-recent-items';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';
import type {
  IssueDetail,
  IssueLabel,
  IssueUser,
  WorkflowState,
} from '@/types/issues';

// ---------------------------------------------------------------------------
// GraphQL mutations (queries replaced by MobX store reads)
// ---------------------------------------------------------------------------

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      lastSyncId
      issue {
        id identifier title priority stateId assigneeId dueDate description
        createdAt updatedAt labels { id name color }
      }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: ID!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      lastSyncId
      issue {
        id identifier title priority stateId assigneeId dueDate description
        createdAt updatedAt labels { id name color }
      }
    }
  }
`;

const ISSUE_ARCHIVE_MUTATION = `
  mutation IssueArchive($id: ID!) {
    issueArchive(id: $id) {
      success
      lastSyncId
    }
  }
`;

const ISSUE_DELETE_MUTATION = `
  mutation IssueDelete($id: ID!) {
    issueDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

// ---------------------------------------------------------------------------
// Page component (observer so it re-renders on MobX store changes)
// ---------------------------------------------------------------------------

const TeamIssuesPage = observer(function TeamIssuesPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const router = useRouter();
  const {
    issueStore,
    teamStore,
    userStore,
    workflowStateStore,
    labelStore,
    syncStore,
  } = useStore();

  // One queue per component mount — unmounting the page cleans up the reference
  const txQueue = useMemo(() => new TransactionQueue(), []);

  // UI state (local to this page)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Which property popover to force-open on the selected row (keyboard shortcut)
  const [openProperty, setOpenProperty] = useState<OpenProperty>(null);

  // Recent items tracking (for command palette) — scoped to this workspace
  const { addRecent } = useRecentItems(workspace);

  // ── Store-derived values ─────────────────────────────────────────────────

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  const issues: IssueDetail[] = teamId
    ? issueStore.findByTeamId(teamId).map(i => ({
        ...i,
        dueDate: i.dueDate ?? null,
        labels: (i.labelIds ?? [])
          .map(id => labelStore.findById(id))
          .filter((l): l is DBIssueLabel => l !== null)
          .map(l => ({ color: l.color, id: l.id, name: l.name })),
      }))
    : [];

  const states: WorkflowState[] = teamId
    ? workflowStateStore.findByTeamId(teamId)
    : [];

  const users: IssueUser[] = userStore.all.map(u => ({
    avatarBackgroundColor: u.avatarBgColor,
    avatarUrl: u.avatarUrl ?? null,
    displayName: u.displayName,
    id: u.id,
    initials: u.initials,
  }));

  const labels: IssueLabel[] = labelStore.all.map(l => ({
    color: l.color,
    id: l.id,
    name: l.name,
  }));

  const isLoading =
    syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  const detailIssue: IssueDetail | null = (() => {
    if (!detailIssueId) {
      return null;
    }
    const raw = issueStore.findById(detailIssueId);
    if (!raw) {
      return null;
    }
    const issueLabels = (raw.labelIds ?? [])
      .map(id => labelStore.findById(id))
      .filter((l): l is DBIssueLabel => l !== null)
      .map(l => ({ color: l.color, id: l.id, name: l.name }));
    return { ...raw, dueDate: raw.dueDate ?? null, labels: issueLabels };
  })();

  // ── Mutations ─────────────────────────────────────────────────────────────

  const handleUpdate = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const snapshot = issueStore.findById(id);
      issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);

      txQueue.enqueue(
        ISSUE_UPDATE_MUTATION,
        { id, input: patch },
        {
          onError: () => {
            if (snapshot) {
              issueStore.optimisticUpdate(id, snapshot);
            }
          },
          onSuccess: data => {
            const updated = (data as { issueUpdate?: { issue?: DBIssue } })
              ?.issueUpdate?.issue;
            if (updated) {
              issueStore.applySyncAction('U', id, updated);
            }
          },
        },
      );
    },
    [issueStore, txQueue],
  );

  const handleCreate = useCallback(
    async (input: {
      title: string;
      description?: string;
      stateId?: string;
      assigneeId?: string;
      priority: number;
      labelIds: string[];
      dueDate?: string | null;
    }) => {
      if (!teamId) {
        return;
      }
      txQueue.enqueue(
        ISSUE_CREATE_MUTATION,
        { input: { ...input, teamId } },
        {
          onError: err => {
            console.error('[TeamPage] issueCreate failed:', err);
          },
          onSuccess: data => {
            const created = (data as { issueCreate?: { issue?: DBIssue } })
              ?.issueCreate?.issue;
            if (created) {
              issueStore.applySyncAction('I', created.id, created);
            }
          },
        },
      );
    },
    [teamId, issueStore, txQueue],
  );

  const handleArchive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      txQueue.enqueue(
        ISSUE_ARCHIVE_MUTATION,
        { id },
        {
          onError: () => {
            issueStore.optimisticUpdate(id, { archivedAt: null });
          },
          onSuccess: () => {
            // Server delta sync will confirm the archive
          },
        },
      );
      if (selectedId === id) {
        setSelectedId(null);
      }
    },
    [issueStore, txQueue, selectedId],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const snapshot = issueStore.findById(id);
      issueStore.pool.delete(id);
      txQueue.enqueue(
        ISSUE_DELETE_MUTATION,
        { id },
        {
          onError: () => {
            // Restore the issue optimistically if the server rejects the delete
            if (snapshot) {
              issueStore.applySyncAction('I', id, snapshot);
            }
          },
        },
      );
      if (selectedId === id) {
        setSelectedId(null);
      }
    },
    [issueStore, txQueue, selectedId],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const selectedIndex = issues.findIndex(i => i.id === selectedId);
  const hasSelection = selectedId !== null;

  // C — create issue
  useHotkeys('c', () => setCreateOpen(true), {}, []);

  // J / K — navigate list
  useHotkeys(
    'j',
    () => {
      const next = Math.min(selectedIndex + 1, issues.length - 1);
      setSelectedId(issues[next]?.id ?? null);
    },
    {},
    [selectedIndex, issues],
  );
  useHotkeys(
    'k',
    () => {
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedId(issues[prev]?.id ?? null);
    },
    {},
    [selectedIndex, issues],
  );

  // Enter — open detail
  useHotkeys(
    'enter',
    () => {
      if (selectedId) {
        setDetailIssueId(selectedId);
      }
    },
    {},
    [selectedId],
  );

  // Escape — clear selection / close detail
  useHotkeys(
    'escape',
    () => {
      if (detailIssueId) {
        setDetailIssueId(null);
        router.replace(`/${workspace}/team/${teamKey}`, { scroll: false });
      } else {
        setSelectedId(null);
      }
    },
    {},
    [detailIssueId, workspace, teamKey],
  );

  // X — toggle selection checkbox
  useHotkeys(
    'x',
    () => {
      if (selectedId) {
        setSelectedId(prev => (prev === selectedId ? null : selectedId));
      }
    },
    {},
    [selectedId],
  );

  // Issue context shortcuts — only active when an issue is selected
  useHotkeys('s', () => setOpenProperty('status'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys(
    'a',
    () => setOpenProperty('assignee'),
    { enabled: hasSelection },
    [hasSelection],
  );
  useHotkeys(
    'p',
    () => setOpenProperty('priority'),
    { enabled: hasSelection },
    [hasSelection],
  );
  useHotkeys('l', () => setOpenProperty('label'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys('d', () => setOpenProperty('dueDate'), { enabled: hasSelection }, [
    hasSelection,
  ]);

  // Backspace / Delete — archive selected issue
  useHotkeys(
    'backspace',
    () => {
      if (selectedId) {
        handleArchive(selectedId);
      }
    },
    { enabled: hasSelection },
    [selectedId, handleArchive, hasSelection],
  );
  useHotkeys(
    'delete',
    () => {
      if (selectedId) {
        handleArchive(selectedId);
      }
    },
    { enabled: hasSelection },
    [selectedId, handleArchive, hasSelection],
  );

  // G then I — go to my issues (placeholder navigation)
  useChord('g', 'i', () => router.push(`/${workspace}/my-issues`), [workspace]);
  // G then N — go to inbox (placeholder navigation)
  useChord('g', 'n', () => router.push(`/${workspace}/inbox`), [workspace]);

  // ── Open issue and track as recent ────────────────────────────────────────

  const handleOpen = useCallback(
    (id: string) => {
      setDetailIssueId(id);
      router.replace(`/${workspace}/issue/${id}`, { scroll: false });
      const issue = issueStore.findById(id);
      const issueTeam = issue ? teamStore.findById(issue.teamId) : null;
      if (issue && issueTeam) {
        addRecent({
          id: issue.id,
          identifier: issue.identifier,
          teamKey: issueTeam.key,
          title: issue.title,
        });
      }
    },
    [workspace, issueStore, teamStore, addRecent, router],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        Failed to load data. Please refresh.
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Team not found.
      </div>
    );
  }

  const defaultStateId =
    states.find(s => s.type === 'backlog')?.id ?? states[0]?.id;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {team.displayName ?? team.name} — Issues
        </h1>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          New issue
        </button>
      </div>

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto">
        <IssueListView
          issues={issues}
          states={states}
          users={users}
          labels={labels}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={handleOpen}
          onUpdate={handleUpdate}
          onArchive={handleArchive}
          onDelete={handleDelete}
          openProperty={openProperty}
          onPropertyClosed={() => setOpenProperty(null)}
        />
      </div>

      {/* Detail panel */}
      {detailIssue && (
        <IssueDetailPanel
          issue={detailIssue}
          states={states}
          users={users}
          labels={labels}
          onClose={() => {
            setDetailIssueId(null);
            router.replace(`/${workspace}/team/${teamKey}`, { scroll: false });
          }}
          onUpdate={handleUpdate}
        />
      )}

      {/* Create modal */}
      <CreateIssueModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        states={states}
        users={users}
        labels={labels}
        defaultStateId={defaultStateId}
      />
    </div>
  );
});

export default TeamIssuesPage;
