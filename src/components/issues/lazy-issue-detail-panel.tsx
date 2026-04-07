'use client';

import { lazy, Suspense } from 'react';
import { DetailPanelSkeleton } from '@/components/ui/skeleton';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

const IssueDetailPanel = lazy(() =>
  import('./issue-detail-panel').then(m => ({ default: m.IssueDetailPanel })),
);

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
}

interface Props {
  issue: IssueDetail | null;
  labels: IssueLabel[];
  states: WorkflowState[];
  users: IssueUser[];
  onClose: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}

/**
 * Lazy-loaded wrapper around IssueDetailPanel.
 * The panel is only needed when an issue is selected, so deferring the chunk
 * reduces the initial JS bundle for the team/issue-list pages.
 */
export function LazyIssueDetailPanel(props: Props) {
  if (!props.issue) return null;

  return (
    <Suspense fallback={<DetailPanelSkeleton />}>
      <IssueDetailPanel {...props} />
    </Suspense>
  );
}
