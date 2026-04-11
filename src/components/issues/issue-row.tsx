'use client';

import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { AssigneeSelect } from '../properties/assignee-select';
import { CycleSelect } from '../properties/cycle-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { EstimateBadge, EstimatePicker } from '../properties/estimate-picker';
import { LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { StatusSelect } from '../properties/status-select';

export interface IssueRowData {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  stateId: string;
  estimate?: number | null;
  assigneeId?: string | null;
  cycleId?: string | null;
  dueDate?: string | null;
  labels: IssueLabel[];
}

/** Which property popover to open programmatically (e.g., via keyboard shortcut). */
export type OpenProperty =
  | 'status'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'dueDate'
  | 'project'
  | 'cycle'
  | 'estimate'
  | null;

interface IssueRowProps {
  issue: IssueRowData;
  states: WorkflowState[];
  users: IssueUser[];
  allLabels: IssueLabel[];
  teamId?: string;
  estimationType?: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Open a specific property popover immediately (keyboard shortcut support). */
  openProperty?: OpenProperty;
  /** Called when the forced-open property popover closes. */
  onPropertyClosed?: () => void;
  style?: React.CSSProperties;
}

export function IssueRow({
  issue,
  states,
  users,
  allLabels,
  teamId,
  estimationType,
  selected,
  onSelect,
  onOpen,
  onUpdate,
  onContextMenu,
  openProperty,
  onPropertyClosed,
  style,
}: IssueRowProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational row container; interactive children (checkbox, button, selects) provide all a11y. onContextMenu is the only handler.
    <div
      style={style}
      data-testid="issue-row"
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group flex items-center gap-2 border-b border-zinc-100 px-4 py-0 h-9 select-none hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900',
        selected && 'bg-zinc-100 dark:bg-zinc-800',
      )}
      onContextMenu={onContextMenu}
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
        forceOpen={openProperty === 'priority'}
        onClose={onPropertyClosed}
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
        forceOpen={openProperty === 'label'}
        onClose={onPropertyClosed}
      />

      {/* Due date */}
      <DueDatePicker
        value={issue.dueDate}
        onChange={dueDate => onUpdate(issue.id, { dueDate })}
        forceOpen={openProperty === 'dueDate'}
        onClose={onPropertyClosed}
      />

      {/* Assignee */}
      <AssigneeSelect
        value={issue.assigneeId}
        users={users}
        onChange={assigneeId => onUpdate(issue.id, { assigneeId })}
        forceOpen={openProperty === 'assignee'}
        onClose={onPropertyClosed}
      />

      {/* Cycle */}
      {teamId && (
        <CycleSelect
          value={issue.cycleId ?? null}
          teamId={teamId}
          onChange={cycleId => onUpdate(issue.id, { cycleId })}
          open={openProperty === 'cycle'}
          onClose={onPropertyClosed}
        />
      )}

      {/* Estimate — only when team has estimation enabled */}
      {estimationType && estimationType !== 'notUsed' && (
        openProperty === 'estimate' ? (
          <EstimatePicker
            value={issue.estimate}
            estimationType={estimationType}
            onChange={estimate => {
              onUpdate(issue.id, { estimate: estimate ?? undefined });
              onPropertyClosed?.();
            }}
          />
        ) : (
          <EstimateBadge value={issue.estimate} estimationType={estimationType} />
        )
      )}

      {/* Status */}
      <StatusSelect
        value={issue.stateId}
        states={states}
        onChange={stateId => onUpdate(issue.id, { stateId })}
        forceOpen={openProperty === 'status'}
        onClose={onPropertyClosed}
      />
    </div>
  );
}
