'use client';

import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { IssueListView } from '@/components/issues/issue-list-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useStore } from '@/providers/store-provider';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

export default observer(function WorkspacePage() {
  const {
    issueStore,
    workflowStateStore,
    userStore,
    labelStore,
    uiStore,
    syncStore,
  } = useStore();
  const [openProperty, setOpenProperty] = useState<OpenProperty | undefined>();

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useHotkeys('c', () => uiStore.openCreateIssueModal(), {}, [uiStore]);

  useHotkeys(
    'j',
    () => {
      const issues = issueStore.all;
      if (!issues.length) {
        return;
      }
      const idx = issues.findIndex(i => i.id === uiStore.selectedIssueId);
      const next = issues[Math.min(idx + 1, issues.length - 1)];
      uiStore.setSelectedIssueId(next.id);
    },
    {},
    [issueStore, uiStore],
  );

  useHotkeys(
    'k',
    () => {
      const issues = issueStore.all;
      if (!issues.length) {
        return;
      }
      const idx = issues.findIndex(i => i.id === uiStore.selectedIssueId);
      const prev = issues[Math.max(idx - 1, 0)];
      uiStore.setSelectedIssueId(prev.id);
    },
    {},
    [issueStore, uiStore],
  );

  useHotkeys(
    's',
    () => {
      if (uiStore.selectedIssueId) {
        setOpenProperty('status');
      }
    },
    {},
    [uiStore],
  );

  useHotkeys(
    'p',
    () => {
      if (uiStore.selectedIssueId) {
        setOpenProperty('priority');
      }
    },
    {},
    [uiStore],
  );

  // ── Data mappings ─────────────────────────────────────────────────────────

  const states: WorkflowState[] = workflowStateStore.all.map(s => ({
    color: s.color,
    id: s.id,
    name: s.name,
    type: s.type,
  }));

  const users: IssueUser[] = userStore.all.map(u => ({
    avatarBackgroundColor: u.avatarBgColor,
    avatarUrl: u.avatarUrl,
    displayName: u.displayName,
    id: u.id,
    initials: u.initials,
  }));

  const labels: IssueLabel[] = labelStore.all.map(l => ({
    color: l.color,
    id: l.id,
    name: l.name,
  }));

  const issues = issueStore.all.map(issue => ({
    assigneeId: issue.assigneeId,
    dueDate: issue.dueDate,
    id: issue.id,
    identifier: issue.identifier,
    labels: issue.labelIds
      .map(id => labelStore.findById(id))
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map(l => ({ color: l.color, id: l.id, name: l.name })),
    priority: issue.priority,
    stateId: issue.stateId,
    title: issue.title,
  }));

  const detailIssue = uiStore.detailIssueId
    ? issueStore.findById(uiStore.detailIssueId)
    : null;

  // Show skeleton while the first sync bootstrap is running
  if (syncStore.status === 'bootstrapping') {
    return <IssueListSkeleton />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-y-auto">
        <IssueListView
          issues={issues}
          states={states}
          users={users}
          labels={labels}
          selectedId={uiStore.selectedIssueId}
          onSelect={id => uiStore.setSelectedIssueId(id)}
          onOpen={id => uiStore.setDetailIssueId(id)}
          onUpdate={(_id, _patch) => {
            // TODO: wire to GraphQL mutation in a future sprint
          }}
          openProperty={openProperty}
          onPropertyClosed={() => setOpenProperty(undefined)}
        />
      </div>

      <LazyIssueDetailPanel
        labels={labels}
        issue={
          detailIssue
            ? {
                assigneeId: detailIssue.assigneeId,
                createdAt: detailIssue.createdAt,
                description: detailIssue.description,
                dueDate: detailIssue.dueDate,
                id: detailIssue.id,
                identifier: detailIssue.identifier,
                labels: detailIssue.labelIds
                  .map(id => labelStore.findById(id))
                  .filter((l): l is NonNullable<typeof l> => l !== null)
                  .map(l => ({ color: l.color, id: l.id, name: l.name })),
                priority: detailIssue.priority,
                stateId: detailIssue.stateId,
                title: detailIssue.title,
                updatedAt: detailIssue.updatedAt,
              }
            : null
        }
        states={states}
        users={users}
        onClose={() => uiStore.setDetailIssueId(null)}
        onUpdate={(_id, _patch) => {
          // TODO: wire to GraphQL mutation in a future sprint
        }}
      />
    </div>
  );
});
