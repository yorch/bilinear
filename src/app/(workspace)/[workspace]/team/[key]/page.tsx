'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { IssueDetailPanel } from '@/components/issues/issue-detail-panel';
import { IssueListView } from '@/components/issues/issue-list-view';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { gql } from '@/lib/graphql';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
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

// ---------------------------------------------------------------------------
// Page component (observer so it re-renders on MobX store changes)
// ---------------------------------------------------------------------------

const TeamIssuesPage = observer(function TeamIssuesPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const router = useRouter();
  const { issueStore, teamStore, userStore, workflowStateStore, labelStore, syncStore } =
    useStore();

  // One queue per component mount — unmounting the page cleans up the reference
  const txQueue = useMemo(() => new TransactionQueue(), []);

  // UI state (not in MobX — local to this page)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // ── Store-derived values ─────────────────────────────────────────────────
  // No useMemo here — inside observer() MobX tracks every observable access
  // during render and re-renders whenever they change (including in-place Map
  // updates that don't alter pool.size, e.g. optimisticUpdate).

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

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  const detailIssue: IssueDetail | null = (() => {
    if (!detailIssueId) return null;
    const raw = issueStore.findById(detailIssueId);
    if (!raw) return null;
    const issueLabels = (raw.labelIds ?? [])
      .map(id => labelStore.findById(id))
      .filter((l): l is DBIssueLabel => l !== null)
      .map(l => ({ color: l.color, id: l.id, name: l.name }));
    return { ...raw, dueDate: raw.dueDate ?? null, labels: issueLabels };
  })();

  // Keyboard shortcuts
  useHotkeys('c', () => setCreateOpen(true), []);

  const selectedIndex = issues.findIndex(i => i.id === selectedId);

  useHotkeys('j', () => {
    const next = Math.min(selectedIndex + 1, issues.length - 1);
    setSelectedId(issues[next]?.id ?? null);
  }, [selectedIndex, issues]);

  useHotkeys('k', () => {
    const prev = Math.max(selectedIndex - 1, 0);
    setSelectedId(issues[prev]?.id ?? null);
  }, [selectedIndex, issues]);

  useHotkeys('enter', () => {
    if (selectedId) setDetailIssueId(selectedId);
  }, [selectedId]);

  // Update an issue — optimistic via MobX, confirmed/rolled-back via server
  const handleUpdate = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      // Capture snapshot for rollback in case of permanent failure
      const snapshot = issueStore.findById(id);

      issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);

      txQueue.enqueue(
        ISSUE_UPDATE_MUTATION,
        { id, input: patch },
        {
          onError: () => {
            // Restore pre-patch state on permanent failure
            if (snapshot) {
              issueStore.optimisticUpdate(id, snapshot);
            }
          },
          onSuccess: (data) => {
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

  // Create issue
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
      if (!teamId) return;
      txQueue.enqueue(
        ISSUE_CREATE_MUTATION,
        { input: { ...input, teamId } },
        {
          onError: (err) => {
            console.error('[TeamPage] issueCreate failed:', err);
          },
          onSuccess: (data) => {
            const created = (
              data as { issueCreate?: { issue?: DBIssue } }
            )?.issueCreate?.issue;
            if (created) {
              issueStore.applySyncAction('I', created.id, created);
            }
          },
        },
      );
    },
    [teamId, issueStore, txQueue],
  );

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
          onOpen={id => {
            setDetailIssueId(id);
            router.replace(`/${workspace}/issue/${id}`, { scroll: false });
          }}
          onUpdate={handleUpdate}
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
