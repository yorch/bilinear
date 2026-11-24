'use client';

import { MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useIssueRemoval } from '@/hooks/use-issue-removal';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { IssueContextMenu } from './issue-context-menu';

interface IssueActionsMenuProps {
  issue: IssueDetail;
  labels: IssueLabel[];
  /** Called after the issue is archived or deleted from this surface (leave the page / close the panel). */
  onRemoved: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  users: IssueUser[];
}

/**
 * The "⋯" button on the issue detail surfaces. It opens the same menu the list
 * rows open on right-click, which is otherwise unreachable on touch devices.
 */
export const IssueActionsMenu = observer(function IssueActionsMenu({
  issue,
  labels,
  onRemoved,
  onUpdate,
  states,
  users,
}: IssueActionsMenuProps) {
  const t = useTranslations();
  const { issueStore } = useStore();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const { archive, deleteDialogProps, requestDelete } = useIssueRemoval({
    onRemoved: () => onRemoved(),
  });
  // Read from the store so the menu's current-value ticks follow live edits.
  const live = issueStore.findById(issue.id);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    // Anchor under the button, right-aligned: the menu is ~200px wide and the
    // button sits at the header's trailing edge. The menu clamps itself to the viewport.
    setAnchor(rect ? { x: rect.right - 200, y: rect.bottom + 4 } : { x: 0, y: 0 });
  };

  return (
    <>
      <button
        aria-expanded={anchor !== null}
        aria-haspopup="menu"
        aria-label={t('issues.moreActions')}
        className={cn('rounded p-1 text-muted-foreground hover:bg-accent', TOUCH_TARGET)}
        data-testid="issue-actions-trigger"
        onClick={openMenu}
        ref={buttonRef}
        title={t('issues.moreActions')}
        type="button"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {anchor && (
        <IssueContextMenu
          currentAssigneeId={live?.assigneeId ?? issue.assigneeId}
          currentLabelIds={issue.labels.map(l => l.id)}
          currentPriority={live?.priority ?? issue.priority}
          currentStateId={live?.stateId ?? issue.stateId}
          identifier={issue.identifier}
          issueId={issue.id}
          labels={labels}
          onArchive={() => archive(issue.id)}
          onClose={() => setAnchor(null)}
          onDelete={() => requestDelete(issue.id)}
          onUpdate={patch => onUpdate(issue.id, patch)}
          states={states}
          title={issue.title}
          users={users}
          x={anchor.x}
          y={anchor.y}
        />
      )}
      <ConfirmDialog {...deleteDialogProps} />
    </>
  );
});
