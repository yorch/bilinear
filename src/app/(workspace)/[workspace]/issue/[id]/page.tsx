'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IssueDetailPanel } from '@/components/issues/issue-detail-panel';
import { gql } from '@/lib/graphql';
import type {
  IssueDetail,
  IssueLabel,
  IssueUser,
  WorkflowState,
} from '@/types/issues';

interface IssueWithTeam extends IssueDetail {
  team: {
    id: string;
    key: string;
    states: WorkflowState[];
    members: Array<{ user: IssueUser }>;
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

export default function IssueDetailPage() {
  const { workspace, id } = useParams<{ workspace: string; id: string }>();
  const router = useRouter();

  const [issue, setIssue] = useState<IssueWithTeam | null>(null);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gql(ISSUE_QUERY, { id })
      .then(data => {
        if (data.data?.issue) {
          setIssue(data.data.issue as IssueWithTeam);
          setLabels((data.data.labels as { nodes: IssueLabel[] })?.nodes ?? []);
        }
      })
      .catch(() => {
        // Network or server error — leave issue null so "not found" is shown
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleUpdate = async (
    issueId: string,
    patch: Record<string, unknown>,
  ) => {
    // Convert labelIds to label objects for optimistic display
    let optimisticPatch: Record<string, unknown> = patch;
    if (Array.isArray(patch.labelIds)) {
      const { labelIds, ...rest } = patch;
      optimisticPatch = {
        ...rest,
        labels: labels.filter(l => (labelIds as string[]).includes(l.id)),
      };
    }

    setIssue(prev => (prev ? { ...prev, ...optimisticPatch } : prev));

    const data = await gql(ISSUE_UPDATE_MUTATION, {
      id: issueId,
      input: patch,
    });
    const updated = (data.data?.issueUpdate as { issue?: IssueDetail })?.issue;
    if (updated) {
      setIssue(prev => (prev ? { ...prev, ...updated } : prev));
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
