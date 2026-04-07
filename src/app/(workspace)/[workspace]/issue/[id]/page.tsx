'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IssueDetailPanel } from '@/components/issues/issue-detail-panel';

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

interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority: number;
  stateId: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels: IssueLabel[];
  createdAt: string;
  updatedAt: string;
  team: {
    id: string;
    key: string;
    states: WorkflowState[];
    members: Array<{ user: User }>;
  };
}

const ISSUE_QUERY = `
  query Issue($id: ID!) {
    issue(id: $id) {
      id identifier title description priority stateId assigneeId dueDate createdAt updatedAt
      labels { id name color }
      team {
        id key
        states { id name color type }
        members { user { id displayName initials avatarUrl avatarBackgroundColor } }
      }
    }
    labels {
      nodes { id name color }
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

export default function IssueDetailPage() {
  const { workspace, id } = useParams<{ workspace: string; id: string }>();
  const router = useRouter();

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gql(ISSUE_QUERY, { id }).then(data => {
      if (data.data?.issue) {
        setIssue(data.data.issue);
        setLabels(data.data.labels?.nodes ?? []);
      }
      setLoading(false);
    });
  }, [id]);

  const handleUpdate = async (
    issueId: string,
    patch: Record<string, unknown>,
  ) => {
    setIssue(prev => (prev ? { ...prev, ...patch } : prev));
    const data = await gql(ISSUE_UPDATE_MUTATION, {
      id: issueId,
      input: patch,
    });
    if (data.data?.issueUpdate?.issue) {
      setIssue(prev =>
        prev ? { ...prev, ...data.data.issueUpdate.issue } : prev,
      );
    }
  };

  const handleClose = () => {
    if (issue) {
      router.push(`/${workspace}/team/${issue.team.key}`);
    } else {
      router.push(`/${workspace}`);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Issue not found.
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <IssueDetailPanel
        issue={issue}
        states={issue.team.states}
        users={issue.team.members.map(m => m.user)}
        labels={labels}
        onClose={handleClose}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
