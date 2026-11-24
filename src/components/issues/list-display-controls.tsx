'use client';

import { Check, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ListGroupBy } from '@/components/issues/issue-list-view';
import { SimpleSelect } from '@/components/ui/select';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import type { ListOrderBy } from '@/components/views/view-layout';
import { useTranslations } from '@/hooks/use-translations';
import { COMPLETED_ISSUES_MODES, type CompletedIssuesMode } from '@/lib/issue-list-visibility';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface ListDisplayControlsProps {
  /** "Completed issues" choice; the control only renders when `onCompleted` is supplied. */
  completed?: CompletedIssuesMode;
  groupBy: ListGroupBy;
  /** The group-by choices to offer (default: status, assignee, priority, none). */
  groupOptions?: readonly ListGroupBy[];
  /** Extra actions (e.g. CSV export) that fold into the mobile Display panel. */
  mobileExtra?: ReactNode;
  onCompleted?: (value: CompletedIssuesMode) => void;
  onGroupBy: (value: ListGroupBy) => void;
  onOrderBy: (value: ListOrderBy) => void;
  orderBy: ListOrderBy;
}

export const DEFAULT_GROUP_OPTIONS: readonly ListGroupBy[] = [
  'status',
  'assignee',
  'priority',
  'none',
];
/** Every grouping the list can render. */
export const ALL_GROUP_OPTIONS: readonly ListGroupBy[] = [
  'status',
  'assignee',
  'priority',
  'project',
  'cycle',
  'label',
  'none',
];
const ORDER_VALUES: readonly ListOrderBy[] = [
  'manual',
  'priority',
  'updated',
  'created',
  'dueDate',
];

const GROUP_LABEL_KEYS: Record<ListGroupBy, string> = {
  assignee: 'issues.groupByAssignee',
  cycle: 'issues.groupByCycle',
  label: 'issues.groupByLabelOption',
  none: 'issues.groupByNone',
  priority: 'issues.groupByPriority',
  project: 'issues.groupByProject',
  status: 'issues.groupByStatus',
};

const ORDER_LABEL_KEYS: Record<ListOrderBy, string> = {
  created: 'issues.orderByCreated',
  dueDate: 'issues.orderByDueDate',
  manual: 'issues.orderByManual',
  priority: 'issues.orderByPriority',
  updated: 'issues.orderByUpdated',
};

const COMPLETED_LABEL_KEYS: Record<CompletedIssuesMode, string> = {
  all: 'issues.completedAll',
  none: 'issues.completedNone',
  pastWeek: 'issues.completedPastWeek',
};

/** One titled radio-style group of options inside the mobile Display panel. */
function PanelSection({
  onSelect,
  options,
  title,
  value,
}: {
  onSelect: (value: string) => void;
  options: { label: string; value: string }[];
  title: string;
  value: string;
}) {
  return (
    <div role="group" aria-label={title}>
      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {options.map(o => (
        <button
          aria-pressed={o.value === value}
          className={cn(
            POPOVER_ITEM_CLASS,
            'whitespace-nowrap',
            o.value === value && 'bg-accent/50',
          )}
          key={o.value}
          onClick={() => onSelect(o.value)}
          type="button"
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {o.value === value && <Check className="h-3.5 w-3.5" />}
          </span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The list view's display options: group by, order by and (optionally) which
 * completed issues to show. Rendered in the page header's action strip.
 *
 * From `md` up they are separate inline selects, the list counterpart of
 * `BoardControls`. Below `md` they fold into ONE "Display" button with a panel,
 * because three ghost selects plus the toggles wrapped the phone header into
 * three rows of chrome before the first issue.
 */
export function ListDisplayControls({
  completed,
  groupBy,
  groupOptions = DEFAULT_GROUP_OPTIONS,
  mobileExtra,
  onCompleted,
  onGroupBy,
  onOrderBy,
  orderBy,
}: ListDisplayControlsProps) {
  const t = useTranslations();
  const groupItems = groupOptions.map(value => ({ label: t(GROUP_LABEL_KEYS[value]), value }));
  const orderItems = ORDER_VALUES.map(value => ({ label: t(ORDER_LABEL_KEYS[value]), value }));
  const completedItems = COMPLETED_ISSUES_MODES.map(value => ({
    label: t(COMPLETED_LABEL_KEYS[value]),
    value,
  }));
  const showCompleted = completed !== undefined && onCompleted !== undefined;

  return (
    <>
      <div className="flex items-center gap-2 max-md:hidden">
        <SimpleSelect
          ariaLabel={t('issues.groupByLabel')}
          onChange={value => onGroupBy(value as ListGroupBy)}
          options={groupItems}
          value={groupBy}
          variant="ghost"
        />
        <SimpleSelect
          ariaLabel={t('issues.orderByLabel')}
          onChange={value => onOrderBy(value as ListOrderBy)}
          options={orderItems}
          value={orderBy}
          variant="ghost"
        />
        {showCompleted && (
          <SimpleSelect
            ariaLabel={t('issues.completedIssuesLabel')}
            onChange={value => onCompleted(value as CompletedIssuesMode)}
            options={completedItems}
            value={completed}
            variant="ghost"
          />
        )}
      </div>

      <div className="md:hidden" data-testid="display-menu">
        <SelectPopover
          align="left"
          panelClassName="max-h-[70vh] w-60 overflow-y-auto pb-1"
          triggerChildren={
            <>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="text-xs">{t('issues.display')}</span>
            </>
          }
          triggerClassName={cn('gap-1 px-2 py-1 text-muted-foreground', TOUCH_TARGET)}
          triggerTitle={t('issues.display')}
        >
          {() => (
            <div>
              <PanelSection
                onSelect={v => onGroupBy(v as ListGroupBy)}
                options={groupItems}
                title={t('issues.groupByLabel')}
                value={groupBy}
              />
              <PanelSection
                onSelect={v => onOrderBy(v as ListOrderBy)}
                options={orderItems}
                title={t('issues.orderByLabel')}
                value={orderBy}
              />
              {showCompleted && (
                <PanelSection
                  onSelect={v => onCompleted(v as CompletedIssuesMode)}
                  options={completedItems}
                  title={t('issues.completedIssuesLabel')}
                  value={completed}
                />
              )}
              {mobileExtra && (
                <div className="mt-1 border-t border-border px-1 pt-1">{mobileExtra}</div>
              )}
            </div>
          )}
        </SelectPopover>
      </div>
    </>
  );
}
