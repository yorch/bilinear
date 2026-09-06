'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { InlineRetry } from '@/components/shared/inline-retry';
import { DetailPanelSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, isGqlErrorCode } from '@/lib/graphql';
import { toIssueDetail, toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

/** One page load: the issue plus the workspace label set its picker offers. */
interface LoadedIssue {
  issue: IssueWithTeam;
  labels: IssueLabel[];
}

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
      id identifier title description priority estimate stateId teamId assigneeId projectId cycleId dueDate createdAt updatedAt
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

const IssueDetailPage = observer(function IssueDetailPage() {
  const t = useTranslations();
  const { workspace, id } = useParams<{ workspace: string; id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { issueStore, teamStore, workflowStateStore, labelStore, userStore } = useStore();

  // `from`/`fromLabel` are set by list pages (my-issues, project, custom
  // views, etc.) when linking into this route, so close/breadcrumb can
  // return to the actual referrer instead of always falling back to the
  // issue's own team page. Validated to stay within this workspace.
  const fromPath = searchParams.get('from');
  const fromLabel = searchParams.get('fromLabel');
  const returnTo = fromPath?.startsWith(`/${workspace}/`) && fromLabel ? fromPath : null;

  const [issue, setIssue] = useState<IssueWithTeam | null>(null);
  const [labels, setLabels] = useState<IssueLabel[]>([]);

  useDocumentTitle(issue ? `${issue.identifier} ${issue.title}` : null);

  const loadIssue = useCallback(async (): Promise<LoadedIssue | null> => {
    // If the issue is only in the local store (e.g. optimistic or temp id),
    // build the detail view from store data instead of fetching from server.
    const storeIssue = issueStore.findById(id);
    if (storeIssue && id.startsWith('temp-')) {
      const team = teamStore.findById(storeIssue.teamId);
      const states = team ? workflowStateStore.findByTeamId(team.id) : [];
      const members = toIssueUsers(userStore.all).map(user => ({ user }));
      const localIssue: IssueWithTeam = {
        ...toIssueDetail(storeIssue, labelStore),
        team: {
          id: team?.id ?? storeIssue.teamId,
          key: team?.key ?? '',
          members,
          states,
        },
      };
      return {
        issue: localIssue,
        labels: toIssueLabels(labelStore.all),
      };
    }

    // `gqlMutate` rather than raw `gql`: a missing issue comes back as a
    // NOT_FOUND *error* alongside `data.issue === null`, so reading `data`
    // alone cannot tell "this issue does not exist" from "the request failed".
    // Both used to land on "Issue not found", which told someone whose network
    // had dropped that their issue was gone.
    const data = await gqlMutate(ISSUE_QUERY, { id });
    if (!data.issue) {
      return null;
    }
    return {
      issue: data.issue as IssueWithTeam,
      labels: (data.labels as { nodes: IssueLabel[] } | undefined)?.nodes ?? [],
    };
  }, [id, issueStore, teamStore, workflowStateStore, labelStore, userStore]);

  const {
    cause,
    error: loadFailed,
    loading,
    refetch: reloadIssue,
  } = useRetryableFetch<LoadedIssue | null>(loadIssue, [loadIssue], null, {
    onData: loaded => {
      if (loaded) {
        setIssue(loaded.issue);
        setLabels(loaded.labels);
      }
    },
  });

  // A NOT_FOUND is an answer, not a failure — it renders as "no such issue"
  // rather than as something worth retrying.
  const notFound = !loading && (isGqlErrorCode(cause, 'NOT_FOUND') || (!loadFailed && !issue));

  // This route renders from its own local `issue` useState rather than the
  // shared issueStore (it can show an issue the store hasn't hydrated yet —
  // see the temp-id branch above), so the default issueStore-backed
  // `useIssueUpdate()` behavior would optimistically write to state this
  // page doesn't read from. `useIssueUpdate`'s override hooks let this route
  // share the exact same TransactionQueue enqueue / offline-queue / rollback
  // / reconcile implementation as every other issue surface, just pointed at
  // this page's local `issue` state instead of the store.
  const snapshotLocal = useCallback(() => issue, [issue]);

  const applyLocal = useCallback(
    (_issueId: string, patch: unknown) => {
      const p = patch as Record<string, unknown>;
      // Convert labelIds to label objects for optimistic display in this
      // page's own issue snapshot (a plain useState, not the shared
      // issueStore — this route can render an issue the store hasn't
      // hydrated yet, so it keeps its own copy for immediate feedback).
      // Rollback (re-applying a full prior snapshot) has no `labelIds` key,
      // so it skips this branch and merges the snapshot's own `labels` as-is.
      let optimisticPatch: Record<string, unknown> = p;
      if (Array.isArray(p.labelIds)) {
        const { labelIds, ...rest } = p;
        optimisticPatch = {
          ...rest,
          labels: labels.filter(l => (labelIds as string[]).includes(l.id)),
        };
      }
      setIssue(prev => (prev ? { ...prev, ...optimisticPatch } : prev));
    },
    [labels],
  );

  const reconcileLocal = useCallback((_issueId: string, updated: Record<string, unknown>) => {
    setIssue(prev => (prev ? { ...prev, ...updated } : prev));
  }, []);

  const handleUpdate = useIssueUpdate({
    apply: applyLocal,
    reconcile: reconcileLocal,
    snapshot: snapshotLocal,
  });

  const handleClose = () => {
    if (returnTo) {
      router.push(returnTo);
    } else if (issue) {
      router.push(`/${workspace}/team/${issue.team.key}`);
    } else {
      router.push(`/${workspace}`);
    }
  };

  if (loading) {
    return <DetailPanelSkeleton />;
  }

  if (notFound) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('issueDetail.issueNotFound')}
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <InlineRetry
          message={getErrorMessage(cause, t('common.somethingWentWrong'))}
          onRetry={() => void reloadIssue()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <LazyIssueDetailPanel
        breadcrumb={
          returnTo ? { label: fromLabel ?? '', onNavigate: () => router.push(returnTo) } : null
        }
        issue={issue}
        labels={labels}
        onClose={handleClose}
        onUpdate={handleUpdate}
        states={issue.team.states}
        users={issue.team.members.map(m => m.user)}
      />
    </div>
  );
});

export default IssueDetailPage;
