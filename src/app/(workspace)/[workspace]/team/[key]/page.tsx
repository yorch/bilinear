'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { IssueDetailPanel } from '@/components/issues/issue-detail-panel';
import { IssueListView } from '@/components/issues/issue-list-view';
import type { IssueRowData } from '@/components/issues/issue-row';
import { useHotkeys } from '@/hooks/use-hotkeys';

// ---------------------------------------------------------------------------
// GraphQL queries / mutations
// ---------------------------------------------------------------------------

const TEAM_ISSUES_QUERY = `
  query TeamIssues($teamKey: String!, $workspace: String!) {
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
          avatarBackgroundColor: avatarBackgroundColor
        }
      }
    }
    issues(filter: { teamId: $teamKey }) {
      nodes {
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

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch('/api/graphql', {
    body: JSON.stringify({ query, variables }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowState {
  id: string;
  name: string;
  color: string;
  type: string;
}
interface User {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBackgroundColor: string;
}
interface IssueLabel {
  id: string;
  name: string;
  color: string;
}

interface FullIssue extends IssueRowData {
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TeamIssuesPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const router = useRouter();

  const [issues, setIssues] = useState<FullIssue[]>([]);
  const [states, setStates] = useState<WorkflowState[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssue, setDetailIssue] = useState<FullIssue | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Load initial data
  const load = useCallback(async () => {
    const data = await gql(TEAM_ISSUES_QUERY, { teamKey, workspace });
    if (data.errors) {
      return;
    }

    const team = (
      data.data.teams as Array<{
        id: string;
        key: string;
        name: string;
        displayName: string;
        states: WorkflowState[];
        members: Array<{ user: User }>;
      }>
    ).find(t => t.key === teamKey);
    if (!team) {
      return;
    }

    setTeamId(team.id);
    setTeamName(team.displayName ?? team.name);
    setStates(team.states);
    setUsers(team.members.map(m => m.user));
    setIssues(data.data.issues.nodes ?? []);
    setLabels(data.data.labels?.nodes ?? []);
    setLoading(false);
  }, [teamKey, workspace]);

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

  // Update an issue optimistically then refresh
  const handleUpdate = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      // Optimistic update
      setIssues(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
      if (detailIssue?.id === id) {
        setDetailIssue(d => (d ? { ...d, ...patch } : d));
      }

      await gql(ISSUE_UPDATE_MUTATION, { id, input: patch });
    },
    [detailIssue],
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
      if (data.data?.issueCreate?.success) {
        const created = data.data.issueCreate.issue as FullIssue;
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
