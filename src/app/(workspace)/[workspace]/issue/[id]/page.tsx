'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { gql } from '@/lib/graphql';
import { useStore } from '@/providers/store-provider';
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

const IssueDetailPage = observer(function IssueDetailPage() {
  const { workspace, id } = useParams<{ workspace: string; id: string }>();
  const router = useRouter();
  const { issueStore, teamStore, workflowStateStore, labelStore, userStore } =
    useStore();

  const [issue, setIssue] = useState<IssueWithTeam | null>(null);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If the issue is only in the local store (e.g. optimistic or temp id),
    // build the detail view from store data instead of fetching from server.
    const storeIssue = issueStore.findById(id);
    if (storeIssue && id.startsWith('temp-')) {
      const team = teamStore.findById(storeIssue.teamId);
      const states = team ? workflowStateStore.findByTeamId(team.id) : [];
      const members = userStore.all.map(u => ({
        user: {
          avatarBackgroundColor: u.avatarBgColor,
          avatarUrl: u.avatarUrl ?? null,
          displayName: u.displayName,
          id: u.id,
          initials: u.initials,
        },
      }));
      setIssue({
        ...storeIssue,
        dueDate: storeIssue.dueDate ?? null,
        labels: (storeIssue.labelIds ?? [])
          .map(lid => labelStore.findById(lid))
          .filter((l): l is NonNullable<typeof l> => l !== null)
          .map(l => ({ color: l.color, id: l.id, name: l.name })),
        team: {
          id: team?.id ?? storeIssue.teamId,
          key: team?.key ?? '',
          members,
          states,
        },
      });
      setLabels(
        labelStore.all.map(l => ({ color: l.color, id: l.id, name: l.name })),
      );
      setLoading(false);
      return;
    }

    gql(ISSUE_QUERY, { id })
      .then(result => {
        if (result.errors?.length) {
          console.error('[IssueDetailPage] GraphQL errors:', result.errors);
        }
        if (result.data?.issue) {
          setIssue(result.data.issue as IssueWithTeam);
          setLabels(
            (result.data.labels as { nodes: IssueLabel[] })?.nodes ?? [],
          );
        }
      })
      .catch(err => {
        console.error('[IssueDetailPage] Fetch error:', err);
      })
      .finally(() => setLoading(false));
  }, [id, issueStore, teamStore, workflowStateStore, labelStore, userStore]);

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
      <LazyIssueDetailPanel
        issue={issue}
        states={issue.team.states}
        users={issue.team.members.map(m => m.user)}
        labels={labels}
        onClose={handleClose}
        onUpdate={handleUpdate}
      />
    </div>
  );
});

export default IssueDetailPage;
