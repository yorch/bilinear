'use client';

import { lazy, Suspense } from 'react';
import { DetailPanelSkeleton } from '@/components/ui/skeleton';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

const IssueDetailPanel = lazy(() =>
  import('./issue-detail-panel').then(m => ({ default: m.IssueDetailPanel })),
);

interface Props {
  breadcrumb?: { label: string; onNavigate: () => void } | null;
  issue: IssueDetail | null;
  labels: IssueLabel[];
  onClose: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  users: IssueUser[];
}

/**
 * Lazy-loaded wrapper around IssueDetailPanel.
 * The panel is only needed when an issue is selected, so deferring the chunk
 * reduces the initial JS bundle for the team/issue-list pages.
 */
export function LazyIssueDetailPanel(props: Props) {
  if (!props.issue) {
    return null;
  }

  return (
    <Suspense fallback={<DetailPanelSkeleton />}>
      <IssueDetailPanel {...props} />
    </Suspense>
  );
}
