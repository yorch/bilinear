'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { GroupSection } from './group-section';
import type { IssueRowData } from './issue-row';
import { IssueRow } from './issue-row';

interface WorkflowState {
  id: string;
  name: string;
  color: string;
  type: string;
}

interface User {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBackgroundColor: string;
}

interface IssueLabel {
  id: string;
  name: string;
  color: string;
}

interface IssueListViewProps {
  issues: IssueRowData[];
  states: WorkflowState[];
  users: User[];
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

function VirtualIssueList({
  issues,
  states,
  users,
  labels,
  selectedId,
  onSelect,
  onOpen,
  onUpdate,
}: Omit<IssueListViewProps, 'issues'> & { issues: IssueRowData[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: issues.length,
    estimateSize: () => 36,
    getScrollElement: () => parentRef.current,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="overflow-hidden">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vItem => {
          const issue = issues[vItem.index];
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                left: 0,
                position: 'absolute',
                top: 0,
                transform: `translateY(${vItem.start}px)`,
                width: '100%',
              }}
            >
              <IssueRow
                issue={issue}
                states={states}
                users={users}
                allLabels={labels}
                selected={issue.id === selectedId}
                onSelect={() => onSelect(issue.id)}
                onOpen={() => onOpen(issue.id)}
                onUpdate={onUpdate}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
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
          <VirtualIssueList
            issues={groupIssues}
            states={states}
            users={users}
            labels={labels}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />
        </GroupSection>
      ))}
    </div>
  );
}
