'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import type { DBWorkflowState } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser } from '@/types/issues';
import { PriorityIcon } from '../properties/priority-icon';
import type { IssueRowData } from './issue-row';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BoardGroupBy = 'status' | 'assignee' | 'priority';

interface BoardViewProps {
  issues: IssueRowData[];
  states: DBWorkflowState[];
  users: IssueUser[];
  labels: IssueLabel[];
  groupBy: BoardGroupBy;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}

interface Column {
  id: string;
  label: string;
  color?: string;
  issues: IssueRowData[];
}

// ─── Card component ─────────────────────────────────────────────────────────

interface BoardCardProps {
  issue: IssueRowData;
  users: IssueUser[];
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  isDragging?: boolean;
}

function BoardCardInner({
  issue,
  users,
  selected,
  onSelect,
  onOpen,
  isDragging,
}: BoardCardProps) {
  const assignee = issue.assigneeId
    ? users.find(u => u.id === issue.assigneeId)
    : null;

  return (
    <button
      type="button"
      className={cn(
        'w-full cursor-pointer rounded-lg border bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900',
        selected
          ? 'border-indigo-500 ring-1 ring-indigo-500'
          : 'border-zinc-200 dark:border-zinc-700',
        isDragging && 'rotate-2 shadow-lg',
      )}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      {/* Issue identifier & priority */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <PriorityIcon priority={issue.priority} className="h-3.5 w-3.5" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {issue.identifier}
        </span>
      </div>

      {/* Title */}
      <p className="mb-2 line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {issue.title}
      </p>

      {/* Footer: labels + assignee */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {issue.labels.slice(0, 3).map(label => (
            <span
              key={label.id}
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
        </div>

        {assignee && (
          <div
            className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
            style={{ backgroundColor: assignee.avatarBackgroundColor }}
            title={assignee.displayName}
          >
            {assignee.initials}
          </div>
        )}
      </div>

      {/* Due date */}
      {issue.dueDate && (
        <div className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
          {issue.dueDate}
        </div>
      )}
    </button>
  );
}

// ─── Sortable card (drag handle) ────────────────────────────────────────────

function SortableCard({
  issue,
  users,
  selected,
  onSelect,
  onOpen,
}: Omit<BoardCardProps, 'isDragging'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id });

  const style = {
    opacity: isDragging ? 0.4 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BoardCardInner
        issue={issue}
        users={users}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
      />
    </div>
  );
}

// ─── Column component ───────────────────────────────────────────────────────

function BoardColumn({
  column,
  users,
  selectedId,
  onSelect,
  onOpen,
}: {
  column: Column;
  users: IssueUser[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col">
      {/* Column header */}
      <div className="mb-2 flex items-center gap-2 px-1">
        {column.color && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: column.color }}
          />
        )}
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {column.label}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {column.issues.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900/50">
        <SortableContext
          items={column.issues.map(i => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.issues.map(issue => (
            <SortableCard
              key={issue.id}
              issue={issue}
              users={users}
              selected={issue.id === selectedId}
              onSelect={() => onSelect(issue.id)}
              onOpen={() => onOpen(issue.id)}
            />
          ))}
        </SortableContext>

        {column.issues.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-zinc-400 dark:text-zinc-500">
            No issues
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Priority labels ────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

// ─── Main Board View ────────────────────────────────────────────────────────

export function BoardView({
  issues,
  states,
  users,
  groupBy,
  selectedId,
  onSelect,
  onOpen,
  onUpdate,
}: BoardViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  // Build columns based on groupBy
  const columns: Column[] = (() => {
    switch (groupBy) {
      case 'status':
        return states
          .filter(s => !s.archivedAt)
          .sort((a, b) => a.position - b.position)
          .map(state => ({
            color: state.color,
            id: state.id,
            issues: issues
              .filter(i => i.stateId === state.id)
              .sort(
                (a, b) =>
                  (a as { sortOrder?: number }).sortOrder ??
                  0 - ((b as { sortOrder?: number }).sortOrder ?? 0),
              ),
            label: state.name,
          }));

      case 'assignee': {
        const unassigned: IssueRowData[] = [];
        const byUser = new Map<string, IssueRowData[]>();

        for (const issue of issues) {
          if (!issue.assigneeId) {
            unassigned.push(issue);
          } else {
            const list = byUser.get(issue.assigneeId) ?? [];
            list.push(issue);
            byUser.set(issue.assigneeId, list);
          }
        }

        const cols: Column[] = [
          { id: 'unassigned', issues: unassigned, label: 'Unassigned' },
        ];
        for (const user of users) {
          const userIssues = byUser.get(user.id);
          if (userIssues && userIssues.length > 0) {
            cols.push({
              id: user.id,
              issues: userIssues,
              label: user.displayName,
            });
          }
        }
        return cols;
      }

      case 'priority': {
        return [1, 2, 3, 4, 0].map(p => ({
          id: `priority-${p}`,
          issues: issues.filter(i => i.priority === p),
          label: PRIORITY_LABELS[p] ?? `Priority ${p}`,
        }));
      }

      default:
        return [];
    }
  })();

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      return;
    }

    const issueId = String(active.id);
    const overId = String(over.id);

    if (groupBy === 'status') {
      // Find which column the issue was dropped onto
      const targetColumn = columns.find(
        col => col.id === overId || col.issues.some(i => i.id === overId),
      );
      if (targetColumn) {
        const issue = issues.find(i => i.id === issueId);
        if (issue && issue.stateId !== targetColumn.id) {
          onUpdate(issueId, { stateId: targetColumn.id });
        }
      }
    } else if (groupBy === 'assignee') {
      const targetColumn = columns.find(
        col => col.id === overId || col.issues.some(i => i.id === overId),
      );
      if (targetColumn) {
        const newAssigneeId =
          targetColumn.id === 'unassigned' ? null : targetColumn.id;
        const issue = issues.find(i => i.id === issueId);
        if (issue && (issue.assigneeId ?? null) !== newAssigneeId) {
          onUpdate(issueId, { assigneeId: newAssigneeId });
        }
      }
    } else if (groupBy === 'priority') {
      const targetColumn = columns.find(
        col => col.id === overId || col.issues.some(i => i.id === overId),
      );
      if (targetColumn) {
        const newPriority = parseInt(
          targetColumn.id.replace('priority-', ''),
          10,
        );
        const issue = issues.find(i => i.id === issueId);
        if (issue && issue.priority !== newPriority) {
          onUpdate(issueId, { priority: newPriority });
        }
      }
    }
  };

  const activeIssue = activeId ? issues.find(i => i.id === activeId) : null;

  if (issues.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-zinc-400 dark:text-zinc-500">
        No issues
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <div className="flex gap-4 overflow-x-auto p-4">
        {columns.map(column => (
          <BoardColumn
            key={column.id}
            column={column}
            users={users}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue && (
          <BoardCardInner
            issue={activeIssue}
            users={users}
            selected={false}
            onSelect={() => {}}
            onOpen={() => {}}
            isDragging
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
