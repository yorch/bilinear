'use client';

import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { GroupSection } from './group-section';
import type { IssueRowData } from './issue-row';
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
}

interface Group {
  state: WorkflowState;
  issues: IssueRowData[];
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
}: IssueListViewProps) {
  // Group issues by state, preserving workflow state order
  const groups: Group[] = states
    .map(state => ({
      issues: issues.filter(i => i.stateId === state.id),
      state,
    }))
    .filter(g => g.issues.length > 0);

  if (issues.length === 0) {
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
            />
          ))}
        </GroupSection>
      ))}
    </div>
  );
}
