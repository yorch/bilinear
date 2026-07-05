'use client';

import type { ColumnKey } from '@/hooks/use-visible-columns';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { AssigneeSelect } from '../properties/assignee-select';
import { CycleSelect } from '../properties/cycle-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { EstimatePicker } from '../properties/estimate-picker';
import { LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { StatusSelect } from '../properties/status-select';

export interface IssueRowData {
  assigneeId?: string | null;
  cycleId?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  id: string;
  identifier: string;
  labels: IssueLabel[];
  priority: number;
  stateId: string;
  title: string;
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
  allLabels: IssueLabel[];
  /** Whether this row is checked in bulk-selection mode. */
  checked?: boolean;
  /** Active custom-field definitions; only those whose column is visible render. */
  customFields?: DBCustomFieldDefinition[];
  estimationType?: string;
  /** Look up a custom-field value for this issue. */
  getCustomFieldValue?: (definitionId: string) => unknown;
  /**
   * Column visibility. When omitted the row renders every built-in column
   * (legacy behaviour) and no custom-field columns.
   */
  isColumnVisible?: (key: ColumnKey) => boolean;
  issue: IssueRowData;
  onCheck?: (shiftKey: boolean) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onOpen: () => void;
  /** Called when the forced-open property popover closes. */
  onPropertyClosed?: () => void;
  onSelect: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  /** Open a specific property popover immediately (keyboard shortcut support). */
  openProperty?: OpenProperty;
  selected: boolean;
  states: WorkflowState[];
  style?: React.CSSProperties;
  teamId?: string;
  users: IssueUser[];
}

/** Single-line read-only rendering of a custom-field value for the list row. */
function renderCustomFieldValue(def: DBCustomFieldDefinition, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  switch (def.type) {
    case 'checkbox':
      return value === true ? '✓' : '—';
    case 'select': {
      const opt = def.options?.find(o => o.value === value);
      return opt?.label ?? String(value);
    }
    case 'multi_select': {
      if (!Array.isArray(value)) {
        return '—';
      }
      return value.map(v => def.options?.find(o => o.value === v)?.label ?? String(v)).join(', ');
    }
    case 'number':
      return typeof value === 'number' ? String(value) : '—';
    default:
      return String(value);
  }
}

export function IssueRow({
  issue,
  states,
  users,
  allLabels,
  teamId,
  estimationType,
  selected,
  checked,
  onSelect,
  onCheck,
  onOpen,
  onUpdate,
  onContextMenu,
  openProperty,
  onPropertyClosed,
  isColumnVisible,
  customFields,
  getCustomFieldValue,
  style,
}: IssueRowProps) {
  const isBulkMode = onCheck !== undefined;
  // If no visibility function is provided, every built-in column renders
  // (callers that haven't adopted the column picker keep their current UX).
  const visible = (key: Parameters<NonNullable<typeof isColumnVisible>>[0]) =>
    isColumnVisible ? isColumnVisible(key) : true;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational row container; interactive children (checkbox, button, selects) provide all a11y. onContextMenu is the only handler.
    <div
      className={cn(
        'group flex items-center gap-2 border-b border-zinc-100 px-4 py-0 h-9 select-none hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900',
        selected && 'bg-muted',
      )}
      data-selected={selected ? 'true' : undefined}
      data-testid="issue-row"
      onContextMenu={onContextMenu}
      style={style}
    >
      {/* Checkbox */}
      <input
        checked={isBulkMode ? (checked ?? false) : selected}
        className={cn(
          'h-3.5 w-3.5 flex-shrink-0 focus:opacity-100',
          isBulkMode && checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        onChange={
          isBulkMode ? e => onCheck(Boolean((e.nativeEvent as MouseEvent).shiftKey)) : onSelect
        }
        onClick={e => e.stopPropagation()}
        type="checkbox"
      />

      {/* Priority */}
      <PrioritySelect
        forceOpen={openProperty === 'priority'}
        onChange={priority => onUpdate(issue.id, { priority })}
        onClose={onPropertyClosed}
        value={issue.priority}
      />

      {/* Identifier */}
      <span className="w-16 flex-shrink-0 font-mono text-xs text-zinc-400">{issue.identifier}</span>

      {/* Title — clicking anywhere in this area opens the issue */}
      <button
        className="flex-1 truncate cursor-pointer text-left text-sm text-foreground"
        onClick={onOpen}
        type="button"
      >
        {issue.title}
      </button>

      {/* Labels */}
      {visible('labels') && (
        <LabelSelect
          forceOpen={openProperty === 'label'}
          labels={allLabels}
          onChange={labelIds => onUpdate(issue.id, { labelIds })}
          onClose={onPropertyClosed}
          value={issue.labels.map(l => l.id)}
        />
      )}

      {/* Due date */}
      {visible('dueDate') && (
        <DueDatePicker
          forceOpen={openProperty === 'dueDate'}
          onChange={dueDate => onUpdate(issue.id, { dueDate })}
          onClose={onPropertyClosed}
          value={issue.dueDate}
        />
      )}

      {/* Assignee */}
      {visible('assignee') && (
        <AssigneeSelect
          forceOpen={openProperty === 'assignee'}
          onChange={assigneeId => onUpdate(issue.id, { assigneeId })}
          onClose={onPropertyClosed}
          users={users}
          value={issue.assigneeId}
        />
      )}

      {/* Cycle */}
      {teamId && visible('cycle') && (
        <CycleSelect
          onChange={cycleId => onUpdate(issue.id, { cycleId })}
          onClose={onPropertyClosed}
          open={openProperty === 'cycle'}
          teamId={teamId}
          value={issue.cycleId ?? null}
        />
      )}

      {/* Estimate — only when team has estimation enabled */}
      {estimationType && estimationType !== 'notUsed' && visible('estimate') && (
        <EstimatePicker
          estimationType={estimationType}
          forceOpen={openProperty === 'estimate'}
          onChange={estimate => onUpdate(issue.id, { estimate: estimate ?? undefined })}
          onClose={onPropertyClosed}
          value={issue.estimate}
        />
      )}

      {/* Custom field columns (read-only cells — edit via detail panel) */}
      {customFields?.map(def => {
        if (!isColumnVisible?.(`custom:${def.id}`)) {
          return null;
        }
        const raw = getCustomFieldValue?.(def.id);
        return (
          <span
            className="max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground"
            key={def.id}
            title={def.name}
          >
            {renderCustomFieldValue(def, raw)}
          </span>
        );
      })}

      {/* Status */}
      <StatusSelect
        forceOpen={openProperty === 'status'}
        onChange={stateId => onUpdate(issue.id, { stateId })}
        onClose={onPropertyClosed}
        states={states}
        value={issue.stateId}
      />
    </div>
  );
}
