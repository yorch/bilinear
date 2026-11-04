'use client';

import { ArrowLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { IssueDetailContent } from '@/components/issues/issue-detail-content';
import { SubscribeButton, useIssueSubscription } from '@/components/issues/issue-detail-panel';
import { WorkspaceNotFound } from '@/components/layouts/workspace-not-found';
import { InlineRetry } from '@/components/shared/inline-retry';
import { DetailPanelSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, isGqlErrorCode } from '@/lib/graphql';
import { toIssueDetail, toIssueLabels, toIssueSyncRow, toIssueUsers } from '@/lib/issue-mappers';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

/** What a cold-miss fetch returns: the issue row plus the team data the store may not have yet. */
interface FetchedIssue {
  issue: Record<string, unknown>;
  labels: IssueLabel[];
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
      id identifier number title description priority estimate stateId teamId organizationId
      assigneeId projectId cycleId parentId dueDate startDate snoozedUntilAt projectMilestoneId
      branchName sortOrder prioritySortOrder trashed createdAt updatedAt
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

  // The page renders from the shared `issueStore` — the same pool the list and
  // the overlay panel read — so a remote edit (WS SyncAction), a start date or a
  // parent link shows up here exactly as it does there. It used to hold a
  // one-shot GraphQL snapshot in `useState`, which never saw either.
  const storeIssue = issueStore.findById(id);

  // The server is only asked on a cold miss (a deep link before bootstrap has
  // filled the store). The fetched row is written into the store, after which
  // the page reads it from there like any other issue.
  const [fetched, setFetched] = useState<FetchedIssue | null>(null);

  const loadIssue = useCallback(async (): Promise<FetchedIssue | null> => {
    if (issueStore.findById(id)) {
      return null;
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
    const issue = data.issue as Record<string, unknown> & { team: FetchedIssue['team'] };
    const { team, ...row } = issue;
    return {
      issue: row,
      labels: (data.labels as { nodes: IssueLabel[] } | undefined)?.nodes ?? [],
      team,
    };
  }, [id, issueStore]);

  const {
    cause,
    error: loadFailed,
    loading,
    refetch: reloadIssue,
  } = useRetryableFetch<FetchedIssue | null>(loadIssue, [loadIssue], null, {
    onData: loaded => {
      if (!loaded) {
        return;
      }
      setFetched(loaded);
      const syncRow = toIssueSyncRow(loaded.issue);
      if (syncRow && !issueStore.findById(id)) {
        issueStore.applySyncAction('U', id, syncRow);
      }
    },
  });

  const team = storeIssue ? teamStore.findById(storeIssue.teamId) : null;
  const parentIssue = storeIssue?.parentId ? issueStore.findById(storeIssue.parentId) : null;

  const issue: IssueDetail | null = storeIssue ? toIssueDetail(storeIssue, labelStore) : null;

  // Prefer the stores for team data (live); fall back to what the cold-miss
  // fetch brought with it for a store that has not bootstrapped yet.
  const storeStates = storeIssue ? workflowStateStore.findByTeamId(storeIssue.teamId) : [];
  const states: WorkflowState[] =
    storeStates.length > 0 ? storeStates : (fetched?.team.states ?? []);
  const storeUsers = toIssueUsers(userStore.all);
  const users: IssueUser[] =
    storeUsers.length > 0 ? storeUsers : (fetched?.team.members.map(m => m.user) ?? []);
  const storeLabels = toIssueLabels(labelStore.all);
  const labels: IssueLabel[] = storeLabels.length > 0 ? storeLabels : (fetched?.labels ?? []);
  const teamKey = team?.key ?? fetched?.team.key ?? '';

  useDocumentTitle(issue ? `${issue.identifier} ${issue.title}` : null);

  // A NOT_FOUND is an answer, not a failure — it renders as "no such issue"
  // rather than as something worth retrying. An issue deleted remotely while
  // open leaves the store and lands here too.
  const notFound = !storeIssue && !loading && (isGqlErrorCode(cause, 'NOT_FOUND') || !loadFailed);

  // The default (store-backed) updater: optimistic write, queue, rollback and
  // reconcile all land in the pool this page now reads.
  const handleUpdate = useIssueUpdate();

  const { subscribed, toggle: toggleSubscription } = useIssueSubscription(issue?.id);
  useHotkeys('shift+s', toggleSubscription, {}, [subscribed, issue?.id]);

  const handleClose = () => {
    if (returnTo) {
      router.push(returnTo);
    } else if (teamKey) {
      router.push(`/${workspace}/team/${teamKey}`);
    } else {
      router.push(`/${workspace}`);
    }
  };

  if (!issue && loading) {
    return <DetailPanelSkeleton />;
  }

  if (notFound) {
    return <WorkspaceNotFound title={t('issueDetail.issueNotFound')} />;
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

  // A full page, not the overlay panel. This route used to mount
  // `IssueDetailPanel`, which is a fixed 480px right-hand sheet with its own
  // backdrop — so opening an issue URL directly showed the issue crammed into a
  // narrow column with two thirds of the window blank white. The panel is now
  // overlay-only; both surfaces share `IssueDetailContent`.
  const breadcrumbLabel = returnTo ? (fromLabel ?? '') : t('issueDetail.backToTeam');

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="issue-detail-page">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
            onClick={handleClose}
            type="button"
          >
            <ArrowLeft className="h-3 w-3 shrink-0" />
            <span className="truncate">{breadcrumbLabel}</span>
          </button>
          {team && (
            <>
              <span className="text-muted-foreground">/</span>
              <Link
                className="truncate text-xs text-muted-foreground hover:text-foreground"
                href={`/${workspace}/team/${team.key}`}
              >
                {team.name}
              </Link>
            </>
          )}
          {parentIssue && (
            <>
              <span className="text-muted-foreground">/</span>
              <Link
                className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground"
                data-testid="issue-parent-link"
                href={`/${workspace}/issue/${parentIssue.id}`}
                title={parentIssue.title}
              >
                {parentIssue.identifier}
              </Link>
            </>
          )}
          <span className="text-muted-foreground">/</span>
          <span className="shrink-0 font-mono text-xs text-foreground-secondary">
            {issue.identifier}
          </span>
        </div>
        <SubscribeButton onToggle={toggleSubscription} subscribed={subscribed} />
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <IssueDetailContent
          issue={issue}
          labels={labels}
          layout="page"
          onUpdate={handleUpdate}
          states={states}
          users={users}
        />
      </div>
    </div>
  );
});

export default IssueDetailPage;
