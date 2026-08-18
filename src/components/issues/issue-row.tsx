'use client';

import { AssigneeSelect } from '@/components/properties/assignee-select';
import { CycleSelect } from '@/components/properties/cycle-select';
import { DueDatePicker } from '@/components/properties/due-date-picker';
import { EstimatePicker } from '@/components/properties/estimate-picker';
import { LabelSelect } from '@/components/properties/label-select';
import { PrioritySelect } from '@/components/properties/priority-select';
import { StatusSelect } from '@/components/properties/status-select';
import { usePending } from '@/hooks/use-pending-ids';
import { useTranslations } from '@/hooks/use-translations';
import type { ColumnKey } from '@/hooks/use-visible-columns';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

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
  const t = useTranslations();
  const pending = usePending(issue.id);
  const isBulkMode = onCheck !== undefined;
  // If no visibility function is provided, every built-in column renders
  // (callers that haven't adopted the column picker keep their current UX).
  const visible = (key: Parameters<NonNullable<typeof isColumnVisible>>[0]) =>
    isColumnVisible ? isColumnVisible(key) : true;

  const showCycle = Boolean(teamId) && visible('cycle');
  const showEstimate =
    Boolean(estimationType) && estimationType !== 'notUsed' && visible('estimate');
  const visibleCustomFields =
    customFields?.filter(def => isColumnVisible?.(`custom:${def.id}`)) ?? [];

  /**
   * One shared column template for every row.
   *
   * This used to be an inline flex row, which left the right-hand properties
   * ragged: the label cell is variable-width (0–3 chips), so due date,
   * assignee, cycle, estimate and status all started at a different x on
   * every row. The pending-write dot made it worse — it was rendered
   * conditionally *mid-row*, so an in-flight write shifted that row's title
   * sideways relative to its neighbours.
   *
   * Fixed track widths fix both: every row is its own grid with an identical
   * template (the inputs are all list-level, not per-row), so the columns line
   * up down the page and the pending dot occupies a reserved slot whether or
   * not it is showing.
   */
  const gridTemplateColumns = [
    '0.875rem', // selection checkbox
    '1rem', // priority
    '3.75rem', // identifier
    '0.375rem', // pending-write dot (reserved, so it never shifts the title)
    'minmax(0, 1fr)', // title
    visible('labels') ? '6rem' : null,
    visible('dueDate') ? '4.25rem' : null,
    visible('assignee') ? '1.5rem' : null,
    showCycle ? '4.75rem' : null,
    showEstimate ? '2rem' : null,
    ...visibleCustomFields.map(() => '5.5rem'),
    '7rem', // status
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational row container; interactive children (checkbox, button, selects) provide all a11y. onContextMenu is the only handler.
    <div
      className={cn(
        'group grid h-9 select-none items-center gap-2 border-b border-border px-4 py-0 transition-colors hover:bg-accent',
        // Grid items default to min-width:auto, which would let a wide label
        // set or a long custom-field value blow past its track and re-ragged
        // the columns this template exists to align.
        '[&>*]:min-w-0',
        selected && 'bg-brand-subtle',
      )}
      data-selected={selected ? 'true' : undefined}
      data-testid="issue-row"
      onContextMenu={onContextMenu}
      style={{ gridTemplateColumns, ...style }}
    >
      {/* Checkbox */}
      <input
        checked={isBulkMode ? (checked ?? false) : selected}
        className={cn(
          'h-3.5 w-3.5 accent-brand focus:opacity-100',
          isBulkMode && checked
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 max-md:opacity-100',
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
      <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
        {issue.identifier}
      </span>

      {/* Pending-write indicator — an unconfirmed optimistic write is in
          flight. The slot is always present so showing it can't nudge the
          title; only the dot inside is conditional. */}
      <span className="flex items-center justify-center">
        {pending && (
          <span
            aria-label={t('issues.syncingRow')}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand"
            role="status"
            title={t('issues.syncingRow')}
          />
        )}
      </span>

      {/* Title — clicking anywhere in this area opens the issue */}
      <button
        className="cursor-pointer truncate text-left text-sm text-foreground"
        data-testid="issue-row-title"
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
      {showCycle && teamId && (
        <CycleSelect
          onChange={cycleId => onUpdate(issue.id, { cycleId })}
          onClose={onPropertyClosed}
          open={openProperty === 'cycle'}
          teamId={teamId}
          value={issue.cycleId ?? null}
        />
      )}

      {/* Estimate — only when team has estimation enabled */}
      {showEstimate && estimationType && (
        <EstimatePicker
          estimationType={estimationType}
          forceOpen={openProperty === 'estimate'}
          onChange={estimate => onUpdate(issue.id, { estimate: estimate ?? undefined })}
          onClose={onPropertyClosed}
          value={issue.estimate}
        />
      )}

      {/* Custom field columns (read-only cells — edit via detail panel).
          Driven by the same filtered list the grid template is built from, so
          the cells and the tracks can't drift apart. */}
      {visibleCustomFields.map(def => (
        <span className="truncate text-xs text-muted-foreground" key={def.id} title={def.name}>
          {renderCustomFieldValue(def, getCustomFieldValue?.(def.id))}
        </span>
      ))}

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
