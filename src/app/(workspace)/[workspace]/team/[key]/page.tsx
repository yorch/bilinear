'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { IssueDetailPanel } from '@/components/issues/issue-detail-panel';
import { IssueListView } from '@/components/issues/issue-list-view';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { gql } from '@/lib/graphql';
import type {
  IssueDetail,
  IssueLabel,
  IssueUser,
  WorkflowState,
} from '@/types/issues';

// ---------------------------------------------------------------------------
// GraphQL queries / mutations
// ---------------------------------------------------------------------------

/**
 * Issues are loaded as a nested field of the team so the filter is resolved
 * server-side using the team's UUID — no need to pass teamId separately.
 */
const TEAM_ISSUES_QUERY = `
  query TeamIssues {
    teams {
      id
      key
      name
      displayName
      states {
        id
        name
        color
        type
      }
      members {
        user {
          id
          displayName
          initials
          avatarUrl
          avatarBackgroundColor
        }
      }
      issues {
        id
        identifier
        title
        priority
        stateId
        assigneeId
        dueDate
        description
        createdAt
        updatedAt
        labels { id name color }
      }
    }
    labels {
      nodes { id name color }
    }
  }
`;

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id identifier title priority stateId assigneeId dueDate description createdAt updatedAt
        labels { id name color }
      }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: ID!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id identifier title priority stateId assigneeId dueDate description createdAt updatedAt
        labels { id name color }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TeamIssuesPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const router = useRouter();

  const [issues, setIssues] = useState<IssueDetail[]>([]);
  const [states, setStates] = useState<WorkflowState[]>([]);
  const [users, setUsers] = useState<IssueUser[]>([]);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssue, setDetailIssue] = useState<IssueDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Load initial data
  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await gql(TEAM_ISSUES_QUERY);
      if (data.errors?.length) {
        setError('Failed to load issues.');
        setLoading(false);
        return;
      }

      const team = (
        data.data?.teams as Array<{
          id: string;
          key: string;
          name: string;
          displayName: string;
          states: WorkflowState[];
          members: Array<{ user: IssueUser }>;
          issues: IssueDetail[];
        }>
      )?.find(t => t.key === teamKey);

      if (!team) {
        setError('Team not found.');
        setLoading(false);
        return;
      }

      setTeamId(team.id);
      setTeamName(team.displayName ?? team.name);
      setStates(team.states);
      setUsers(team.members.map(m => m.user));
      setIssues(team.issues ?? []);
      setLabels((data.data?.labels as { nodes: IssueLabel[] })?.nodes ?? []);
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, [teamKey]);

  useEffect(() => {
    load();
  }, [load]);

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
    if (selectedId) {
      const issue = issues.find(i => i.id === selectedId);
      if (issue) {
        setDetailIssue(issue);
      }
    }
  }, [selectedId, issues]);

  // Update an issue optimistically then reconcile from server response
  const handleUpdate = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      // When labelIds are patched, resolve them to label objects for display
      let optimisticPatch: Record<string, unknown> = patch;
      if (Array.isArray(patch.labelIds)) {
        const { labelIds, ...rest } = patch;
        optimisticPatch = {
          ...rest,
          labels: labels.filter(l => (labelIds as string[]).includes(l.id)),
        };
      }

      setIssues(prev =>
        prev.map(i => (i.id === id ? { ...i, ...optimisticPatch } : i)),
      );
      if (detailIssue?.id === id) {
        setDetailIssue(d => (d ? { ...d, ...optimisticPatch } : d));
      }

      const data = await gql(ISSUE_UPDATE_MUTATION, { id, input: patch });
      // Reconcile with server response to catch any server-side normalization
      const updated = (data.data?.issueUpdate as { issue?: IssueDetail })
        ?.issue;
      if (updated) {
        setIssues(prev =>
          prev.map(i => (i.id === id ? { ...i, ...updated } : i)),
        );
        if (detailIssue?.id === id) {
          setDetailIssue(d => (d ? { ...d, ...updated } : d));
        }
      }
    },
    [detailIssue, labels],
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
      if (!teamId) {
        return;
      }
      const data = await gql(ISSUE_CREATE_MUTATION, {
        input: { ...input, teamId },
      });
      const created = (
        data.data?.issueCreate as { success?: boolean; issue?: IssueDetail }
      )?.issue;
      if (created) {
        setIssues(prev => [created, ...prev]);
      }
    },
    [teamId],
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        {error}
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
          {teamName} — Issues
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
            const issue = issues.find(i => i.id === id);
            if (issue) {
              setDetailIssue(issue);
              router.replace(`/${workspace}/issue/${id}`, { scroll: false });
            }
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
            setDetailIssue(null);
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
}
