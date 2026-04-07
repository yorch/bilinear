'use client';

import { cn } from '@/lib/utils';
import { AssigneeSelect } from '../properties/assignee-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { StatusSelect } from '../properties/status-select';

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

export interface IssueRowData {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  stateId: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels: IssueLabel[];
}

interface IssueRowProps {
  issue: IssueRowData;
  states: WorkflowState[];
  users: User[];
  allLabels: IssueLabel[];
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  style?: React.CSSProperties;
}

export function IssueRow({
  issue,
  states,
  users,
  allLabels,
  selected,
  onSelect,
  onOpen,
  onUpdate,
  style,
}: IssueRowProps) {
  return (
    <div
      style={style}
      className={cn(
        'group flex items-center gap-2 border-b border-zinc-100 px-4 py-0 h-9 select-none hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900',
        selected && 'bg-zinc-100 dark:bg-zinc-800',
      )}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        onClick={e => e.stopPropagation()}
        className="h-3.5 w-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
      />

      {/* Priority */}
      <PrioritySelect
        value={issue.priority}
        onChange={priority => onUpdate(issue.id, { priority })}
      />

      {/* Identifier */}
      <span className="w-16 flex-shrink-0 font-mono text-xs text-zinc-400">
        {issue.identifier}
      </span>

      {/* Title — clicking anywhere in this area opens the issue */}
      <button
        type="button"
        className="flex-1 truncate cursor-pointer text-left text-sm text-zinc-900 dark:text-zinc-100"
        onClick={onOpen}
      >
        {issue.title}
      </button>

      {/* Labels */}
      <LabelSelect
        value={issue.labels.map(l => l.id)}
        labels={allLabels}
        onChange={labelIds => onUpdate(issue.id, { labelIds })}
      />

      {/* Due date */}
      <DueDatePicker
        value={issue.dueDate}
        onChange={dueDate => onUpdate(issue.id, { dueDate })}
      />

      {/* Assignee */}
      <AssigneeSelect
        value={issue.assigneeId}
        users={users}
        onChange={assigneeId => onUpdate(issue.id, { assigneeId })}
      />

      {/* Status */}
      <StatusSelect
        value={issue.stateId}
        states={states}
        onChange={stateId => onUpdate(issue.id, { stateId })}
      />
    </div>
  );
}
