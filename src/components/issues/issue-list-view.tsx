'use client';

import { useState } from 'react';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { GroupSection } from './group-section';
import { IssueContextMenu } from './issue-context-menu';
import type { IssueRowData, OpenProperty } from './issue-row';
import { IssueRow } from './issue-row';

interface IssueListViewProps {
  issues: IssueRowData[];
  states: WorkflowState[];
  users: IssueUser[];
  labels: IssueLabel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Which property popover to force-open on the selected issue (keyboard shortcut). */
  openProperty?: OpenProperty;
  onPropertyClosed?: () => void;
}

interface Group {
  state: WorkflowState;
  issues: IssueRowData[];
}

interface ContextMenuState {
  issueId: string;
  identifier: string;
  title: string;
  x: number;
  y: number;
}

export function IssueListView({
  issues,
  states,
  users,
  labels,
  selectedId,
  onSelect,
  onOpen,
  onUpdate,
  onArchive,
  onDelete,
  openProperty,
  onPropertyClosed,
}: IssueListViewProps) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  // Group issues by state, preserving workflow state order
  const groups: Group[] = states
    .map(state => ({
      issues: issues.filter(i => i.stateId === state.id),
      state,
    }))
    .filter(g => g.issues.length > 0);

  if (issues.length === 0 || groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-zinc-400">
        No issues found. Press{' '}
        <kbd className="mx-1 rounded border px-1 font-mono text-xs">C</kbd> to
        create one.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map(({ state, issues: groupIssues }) => (
        <GroupSection
          key={state.id}
          name={state.name}
          color={state.color}
          count={groupIssues.length}
        >
          {groupIssues.map(issue => (
            <IssueRow
              key={issue.id}
              issue={issue}
              states={states}
              users={users}
              allLabels={labels}
              selected={issue.id === selectedId}
              onSelect={() => onSelect(issue.id)}
              onOpen={() => onOpen(issue.id)}
              onUpdate={onUpdate}
              openProperty={issue.id === selectedId ? openProperty : null}
              onPropertyClosed={onPropertyClosed}
              onContextMenu={e => {
                e.preventDefault();
                setCtxMenu({
                  identifier: issue.identifier,
                  issueId: issue.id,
                  title: issue.title,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            />
          ))}
        </GroupSection>
      ))}

      {ctxMenu && (
        <IssueContextMenu
          issueId={ctxMenu.issueId}
          identifier={ctxMenu.identifier}
          title={ctxMenu.title}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onOpen={() => onOpen(ctxMenu.issueId)}
          onArchive={() => onArchive?.(ctxMenu.issueId)}
          onDelete={() => onDelete?.(ctxMenu.issueId)}
        />
      )}
    </div>
  );
}
