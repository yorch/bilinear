'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PriorityIcon, priorityLabelKey } from '@/components/properties/priority-icon';
import { useFormatters } from '@/hooks/use-formatters';
import { usePending } from '@/hooks/use-pending-ids';
import { useTranslations } from '@/hooks/use-translations';
import type { DBWorkflowState } from '@/lib/db';
import { getDueDateColor } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser } from '@/types/issues';
import { UserAvatar } from '../ui/user-avatar';
import type { IssueRowData } from './issue-row';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BoardGroupBy = 'status' | 'assignee' | 'priority';
export type BoardSwimlaneBy = 'assignee' | 'priority' | 'none';

interface BoardViewProps {
  groupBy: BoardGroupBy;
  issues: IssueRowData[];
  labels: IssueLabel[];
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  selectedId: string | null;
  states: DBWorkflowState[];
  swimlaneBy?: BoardSwimlaneBy;
  users: IssueUser[];
}

interface Column {
  color?: string;
  id: string;
  issues: IssueRowData[];
  label: string;
}

// ─── Card component ─────────────────────────────────────────────────────────

interface BoardCardProps {
  isDragging?: boolean;
  issue: IssueRowData;
  multiSelected: boolean;
  onOpen: () => void;
  onSelect: () => void;
  selected: boolean;
  users: IssueUser[];
}

function BoardCardInner({
  issue,
  users,
  selected,
  multiSelected,
  onSelect,
  onOpen,
  isDragging,
}: BoardCardProps) {
  const t = useTranslations();
  const { formatDueDate } = useFormatters();
  const pending = usePending(issue.id);
  const assignee = issue.assigneeId ? users.find(u => u.id === issue.assigneeId) : null;

  return (
    <button
      className={cn(
        'w-full cursor-pointer rounded-lg border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md',
        selected
          ? 'border-indigo-500 ring-1 ring-indigo-500'
          : multiSelected
            ? 'border-blue-500 ring-2 ring-blue-500'
            : 'border-border',
        isDragging && 'rotate-2 shadow-lg',
      )}
      onClick={onSelect}
      onDoubleClick={onOpen}
      type="button"
    >
      {/* Issue identifier & priority */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <PriorityIcon className="h-3.5 w-3.5" priority={issue.priority} />
        <span className="text-xs text-muted-foreground">{issue.identifier}</span>
        {pending && (
          <span
            aria-label={t('issues.syncingRow')}
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary"
            role="status"
            title={t('issues.syncingRow')}
          />
        )}
      </div>

      {/* Title */}
      <p className="mb-2 line-clamp-2 text-sm font-medium text-foreground">{issue.title}</p>

      {/* Footer: labels + assignee */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {issue.labels.slice(0, 3).map(label => (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              key={label.id}
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
        </div>

        {assignee && <UserAvatar size="sm" user={assignee} />}
      </div>

      {/* Due date */}
      {issue.dueDate && (
        <div className={cn('mt-1.5 text-xs', getDueDateColor(issue.dueDate))}>
          {formatDueDate(issue.dueDate)}
        </div>
      )}
    </button>
  );
}

// ─── Sortable card (drag handle) ────────────────────────────────────────────

interface SortableCardProps extends Omit<BoardCardProps, 'isDragging'> {
  columnIssueIds: string[];
  onMultiSelect: (e: React.MouseEvent, issueId: string, columnIssueIds: string[]) => void;
}

function SortableCard({
  issue,
  users,
  selected,
  multiSelected,
  onSelect,
  onOpen,
  onMultiSelect,
  columnIssueIds,
}: SortableCardProps) {
  const t = useTranslations();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style = {
    opacity: isDragging ? 0.4 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      onMultiSelect(e, issue.id, columnIssueIds);
    } else {
      onSelect();
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: dnd-kit's attributes spread supplies role="button"/tabIndex for the keyboard drag handle
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={t('issues.moveIssue', { identifier: issue.identifier })}
      role="button"
      tabIndex={0}
    >
      <BoardCardInner
        isDragging={isDragging}
        issue={issue}
        multiSelected={multiSelected}
        onOpen={onOpen}
        onSelect={() => {}} // handled via wrapper click
        selected={selected}
        users={users}
      />
      {/* Invisible overlay to intercept clicks without interfering with DnD listeners */}
      <button
        aria-label={t('issues.openIssue')}
        className="absolute inset-0 cursor-pointer bg-transparent"
        onClick={handleClick}
        onDoubleClick={onOpen}
        type="button"
      />
    </div>
  );
}

// ─── Column component ───────────────────────────────────────────────────────

function BoardColumn({
  column,
  users,
  selectedId,
  selectedIds,
  onSelect,
  onOpen,
  onMultiSelect,
}: {
  column: Column;
  users: IssueUser[];
  selectedId: string | null;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMultiSelect: (e: React.MouseEvent, issueId: string, columnIssueIds: string[]) => void;
}) {
  const t = useTranslations();
  const { setNodeRef } = useDroppable({ id: column.id });
  const columnIssueIds = column.issues.map(i => i.id);

  return (
    <div className="flex w-[85vw] max-w-72 flex-shrink-0 flex-col sm:w-72">
      {/* Column header */}
      <div className="mb-2 flex items-center gap-2 px-1">
        {column.color && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: column.color }}
          />
        )}
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{column.label}</span>
        <span className="text-xs text-muted-foreground">{column.issues.length}</span>
      </div>

      {/* Cards — column is a droppable area so empty columns accept drops */}
      <div
        className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg bg-muted p-2"
        ref={setNodeRef}
      >
        <SortableContext items={columnIssueIds} strategy={verticalListSortingStrategy}>
          {column.issues.map(issue => (
            <div className="relative" key={issue.id}>
              <SortableCard
                columnIssueIds={columnIssueIds}
                issue={issue}
                multiSelected={selectedIds.has(issue.id)}
                onMultiSelect={onMultiSelect}
                onOpen={() => onOpen(issue.id)}
                onSelect={() => onSelect(issue.id)}
                selected={issue.id === selectedId}
                users={users}
              />
            </div>
          ))}
        </SortableContext>

        {column.issues.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            {t('issues.noIssues')}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Swimlane component ──────────────────────────────────────────────────────

interface BoardSwimlaneProps {
  columns: Omit<Column, 'issues'>[];
  groupBy: BoardGroupBy;
  issues: IssueRowData[];
  label: string;
  onMultiSelect: (e: React.MouseEvent, issueId: string, columnIssueIds: string[]) => void;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  selectedIds: Set<string>;
  users: IssueUser[];
}

function BoardSwimlane({
  label,
  issues,
  columns,
  groupBy,
  users,
  selectedId,
  selectedIds,
  onSelect,
  onOpen,
  onMultiSelect,
}: BoardSwimlaneProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Reuse the same assignment logic as the flat board to ensure consistency
  // (especially for 'assignee' groupBy where col.id is a user ID, not a stateId)
  const swimlaneColumns = assignIssuesToColumns(columns, issues, groupBy);

  return (
    <div className="mb-4">
      {/* Swimlane header */}
      <button
        className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
        onClick={() => setCollapsed(c => !c)}
        type="button"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="text-xs text-muted-foreground">({issues.length})</span>
      </button>

      {!collapsed && (
        <div className="flex gap-4 overflow-x-auto pb-4 pl-6">
          {swimlaneColumns.map(col => (
            <BoardColumn
              column={col}
              key={col.id}
              onMultiSelect={onMultiSelect}
              onOpen={onOpen}
              onSelect={onSelect}
              selectedId={selectedId}
              selectedIds={selectedIds}
              users={users}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helper: build column definitions (without issues) ──────────────────────

function buildColumnDefs(
  groupBy: BoardGroupBy,
  states: DBWorkflowState[],
  users: IssueUser[],
  unassignedLabel: string,
  priorityLabel: (p: number) => string,
): Omit<Column, 'issues'>[] {
  switch (groupBy) {
    case 'status':
      return states
        .filter(s => !s.archivedAt)
        .sort((a, b) => a.position - b.position)
        .map(state => ({
          color: state.color,
          id: state.id,
          label: state.name,
        }));

    case 'assignee': {
      const cols: Omit<Column, 'issues'>[] = [{ id: 'unassigned', label: unassignedLabel }];
      for (const user of users) {
        cols.push({ id: user.id, label: user.displayName });
      }
      return cols;
    }

    case 'priority':
      return [1, 2, 3, 4, 0].map(p => ({
        id: `priority-${p}`,
        label: priorityLabel(p),
      }));

    default:
      return [];
  }
}

function assignIssuesToColumns(
  colDefs: Omit<Column, 'issues'>[],
  issues: IssueRowData[],
  groupBy: BoardGroupBy,
): Column[] {
  return colDefs.map(def => {
    let colIssues: IssueRowData[];

    if (groupBy === 'status') {
      colIssues = issues
        .filter(i => i.stateId === def.id)
        .sort(
          (a, b) =>
            ((a as { sortOrder?: number }).sortOrder ?? 0) -
            ((b as { sortOrder?: number }).sortOrder ?? 0),
        );
    } else if (groupBy === 'assignee') {
      colIssues =
        def.id === 'unassigned'
          ? issues.filter(i => !i.assigneeId)
          : issues.filter(i => i.assigneeId === def.id);
    } else {
      const p = parseInt(def.id.replace('priority-', ''), 10);
      colIssues = issues.filter(i => i.priority === p);
    }

    return { ...def, issues: colIssues };
  });
}

// ─── Main Board View ────────────────────────────────────────────────────────

export function BoardView({
  issues,
  states,
  users,
  groupBy,
  swimlaneBy,
  selectedId,
  onSelect,
  onOpen,
  onUpdate,
}: BoardViewProps) {
  const t = useTranslations();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Multi-select state (internal to the board, separate from parent selectedId)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Track the last-clicked issue id per column for shift-click range select
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(mouseSensor, touchSensor, keyboardSensor);

  // Build column definitions
  const colDefs = buildColumnDefs(groupBy, states, users, t('issues.unassigned'), p =>
    t(priorityLabelKey(p)),
  );

  // Build full columns (with issues) for flat board mode
  const columns: Column[] = assignIssuesToColumns(colDefs, issues, groupBy);

  // Determine if swimlanes should be active
  const useSwimlanes = swimlaneBy != null && swimlaneBy !== 'none' && swimlaneBy !== groupBy;

  // Build swimlane groups when needed
  const swimlaneGroups: {
    id: string;
    label: string;
    issues: IssueRowData[];
  }[] = useSwimlanes
    ? (() => {
        if (swimlaneBy === 'assignee') {
          const unassigned = issues.filter(i => !i.assigneeId);
          const groups: {
            id: string;
            label: string;
            issues: IssueRowData[];
          }[] = [];
          if (unassigned.length > 0) {
            groups.push({
              id: 'unassigned',
              issues: unassigned,
              label: t('issues.unassigned'),
            });
          }
          for (const user of users) {
            const userIssues = issues.filter(i => i.assigneeId === user.id);
            if (userIssues.length > 0) {
              groups.push({
                id: user.id,
                issues: userIssues,
                label: user.displayName,
              });
            }
          }
          return groups;
        }
        // swimlaneBy === 'priority'
        return [1, 2, 3, 4, 0]
          .map(p => ({
            id: `priority-${p}`,
            issues: issues.filter(i => i.priority === p),
            label: t(priorityLabelKey(p)),
          }))
          .filter(g => g.issues.length > 0);
      })()
    : [];

  // ── Multi-select handlers ────────────────────────────────────────────────

  const handleMultiSelect = (e: React.MouseEvent, issueId: string, columnIssueIds: string[]) => {
    if (e.shiftKey && lastClickedId) {
      // Range select within the column
      const start = columnIssueIds.indexOf(lastClickedId);
      const end = columnIssueIds.indexOf(issueId);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        const rangeIds = columnIssueIds.slice(from, to + 1);
        setSelectedIds(prev => {
          const next = new Set(prev);
          for (const id of rangeIds) {
            next.add(id);
          }
          return next;
        });
      }
    } else {
      // Cmd/Ctrl+Click — toggle
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(issueId)) {
          next.delete(issueId);
        } else {
          next.add(issueId);
        }
        return next;
      });
    }
    setLastClickedId(issueId);
  };

  // ── DnD handlers ─────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      return;
    }

    const draggedId = String(active.id);
    const overId = String(over.id);

    // Find which column the dragged card landed in
    const targetColumn = columns.find(
      col => col.id === overId || col.issues.some(i => i.id === overId),
    );
    if (!targetColumn) {
      return;
    }

    // Build patch for a single issue based on target column
    const buildPatch = (issueId: string): Record<string, unknown> => {
      const issue = issues.find(i => i.id === issueId);
      if (!issue) {
        return {};
      }

      const patch: Record<string, unknown> = {};

      if (groupBy === 'status' && issue.stateId !== targetColumn.id) {
        patch.stateId = targetColumn.id;
      } else if (groupBy === 'assignee') {
        const newAssigneeId = targetColumn.id === 'unassigned' ? null : targetColumn.id;
        if ((issue.assigneeId ?? null) !== newAssigneeId) {
          patch.assigneeId = newAssigneeId;
        }
      } else if (groupBy === 'priority') {
        const newPriority = parseInt(targetColumn.id.replace('priority-', ''), 10);
        if (issue.priority !== newPriority) {
          patch.priority = newPriority;
        }
      }

      return patch;
    };

    const isMultiDrag = selectedIds.has(draggedId) && selectedIds.size > 1;

    if (isMultiDrag) {
      // Apply patch to all selected issues
      for (const id of selectedIds) {
        const patch = buildPatch(id);
        if (Object.keys(patch).length > 0) {
          onUpdate(id, patch);
        }
      }
      setSelectedIds(new Set());
    } else {
      // Single drag — also handle within-column reorder
      const patch = buildPatch(draggedId);

      if (overId !== targetColumn.id && overId !== draggedId) {
        const colIssues = targetColumn.issues.filter(i => i.id !== draggedId);
        const overIndex = colIssues.findIndex(i => i.id === overId);
        if (overIndex >= 0) {
          const prev = colIssues[overIndex - 1];
          const next = colIssues[overIndex];
          const prevOrder = (prev as { sortOrder?: number })?.sortOrder ?? 0;
          const nextOrder = (next as { sortOrder?: number })?.sortOrder ?? prevOrder + 1;
          patch.sortOrder = (prevOrder + nextOrder) / 2;
        }
      }

      if (Object.keys(patch).length > 0) {
        onUpdate(draggedId, patch);
      }
    }
  };

  const activeIssue = activeId ? issues.find(i => i.id === activeId) : null;
  const isDraggingMultiple = activeId != null && selectedIds.has(activeId) && selectedIds.size > 1;

  if (issues.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
        {t('issues.noIssues')}
      </div>
    );
  }

  return (
    <DndContext onDragEnd={handleDragEnd} onDragStart={handleDragStart} sensors={sensors}>
      {useSwimlanes ? (
        <div className="p-4">
          {swimlaneGroups.map(group => (
            <BoardSwimlane
              columns={colDefs}
              groupBy={groupBy}
              issues={group.issues}
              key={group.id}
              label={group.label}
              onMultiSelect={handleMultiSelect}
              onOpen={onOpen}
              onSelect={onSelect}
              selectedId={selectedId}
              selectedIds={selectedIds}
              users={users}
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto p-4">
          {columns.map(column => (
            <BoardColumn
              column={column}
              key={column.id}
              onMultiSelect={handleMultiSelect}
              onOpen={onOpen}
              onSelect={onSelect}
              selectedId={selectedId}
              selectedIds={selectedIds}
              users={users}
            />
          ))}
        </div>
      )}

      <DragOverlay>
        {activeIssue &&
          (isDraggingMultiple ? (
            <div className="flex items-center gap-2 rounded-lg border border-blue-500 bg-card px-4 py-3 shadow-lg">
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {t('issues.draggingCount', { count: selectedIds.size })}
              </span>
            </div>
          ) : (
            <BoardCardInner
              isDragging
              issue={activeIssue}
              multiSelected={false}
              onOpen={() => {}}
              onSelect={() => {}}
              selected={false}
              users={users}
            />
          ))}
      </DragOverlay>
    </DndContext>
  );
}
