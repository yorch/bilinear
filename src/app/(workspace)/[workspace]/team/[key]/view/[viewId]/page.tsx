'use client';

import { Eye } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { IssueListView } from '@/components/issues/issue-list-view';
import { PageHeader } from '@/components/ui/page-header';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssueLabel } from '@/lib/db';
import { applyFilters, coerceFilterSet } from '@/lib/filter-engine';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

/**
 * Saved custom view: the issue list filtered by the view's stored FilterSet.
 * This is the target of the sidebar's per-team view links and view favorites.
 */
const CustomViewPage = observer(function CustomViewPage() {
  const {
    workspace,
    key: teamKey,
    viewId,
  } = useParams<{
    workspace: string;
    key: string;
    viewId: string;
  }>();
  const router = useRouter();
  const t = useTranslations();
  const {
    customFieldStore,
    customViewStore,
    issueStore,
    labelStore,
    syncStore,
    teamStore,
    userStore,
    workflowStateStore,
  } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;
  const view = customViewStore.findById(viewId);

  useDocumentTitle(view?.name);

  const states = teamId ? workflowStateStore.findByTeamId(teamId) : [];

  const allIssues: IssueDetail[] = (() => {
    if (!teamId) {
      return [];
    }
    return issueStore.findByTeamId(teamId).map(i => ({
      ...i,
      dueDate: i.dueDate ?? null,
      labels: (i.labelIds ?? [])
        .map(id => labelStore.findById(id))
        .filter((l): l is DBIssueLabel => l !== null)
        .map(l => ({ color: l.color, id: l.id, name: l.name })),
    }));
  })();

  const issues = view
    ? applyFilters(
        allIssues,
        coerceFilterSet(view.filters),
        (issueId, definitionId) => customFieldStore.findValue(issueId, definitionId)?.value ?? null,
      )
    : [];

  const users: IssueUser[] = toIssueUsers(userStore.all);

  const labels: IssueLabel[] = toIssueLabels(labelStore.all);

  const handleUpdate = useIssueUpdate();

  const handleOpen = useCallback(
    (id: string) => {
      const href = buildIssueHref(workspace, id, {
        label: view?.name ?? team?.name ?? teamKey,
        path: `/${workspace}/team/${teamKey}/view/${viewId}`,
      });
      router.push(href);
    },
    [router, workspace, teamKey, viewId, view?.name, team?.name],
  );

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    // A shaped skeleton rather than a centred "Loading…" string: it tells you
    // what is arriving and keeps the page from jumping when it does.
    return <IssueListSkeleton />;
  }

  if (!view || !team) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('customViews.notFound')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageHeader
        count={issues.length}
        description={view.description ?? undefined}
        leading={<Eye className="h-4 w-4 shrink-0 text-muted-foreground" />}
        title={view.name}
      />

      {/* Filtered list */}
      <div className="flex-1 overflow-y-auto">
        <IssueListView
          issues={issues}
          labels={labels}
          onOpen={handleOpen}
          onSelect={setSelectedId}
          onUpdate={handleUpdate}
          selectedId={selectedId}
          states={states}
          teamId={teamId ?? undefined}
          users={users}
        />
      </div>
    </div>
  );
});

export default CustomViewPage;
