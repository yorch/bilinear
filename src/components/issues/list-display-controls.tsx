'use client';

import type { ListGroupBy } from '@/components/issues/issue-list-view';
import { SimpleSelect } from '@/components/ui/select';
import type { ListOrderBy } from '@/components/views/view-layout';
import { useTranslations } from '@/hooks/use-translations';

interface ListDisplayControlsProps {
  groupBy: ListGroupBy;
  onGroupBy: (value: ListGroupBy) => void;
  onOrderBy: (value: ListOrderBy) => void;
  orderBy: ListOrderBy;
}

const GROUP_VALUES: readonly ListGroupBy[] = ['status', 'assignee', 'priority', 'none'];
const ORDER_VALUES: readonly ListOrderBy[] = [
  'manual',
  'priority',
  'updated',
  'created',
  'dueDate',
];

const GROUP_LABEL_KEYS: Record<ListGroupBy, string> = {
  assignee: 'issues.groupByAssignee',
  none: 'issues.groupByNone',
  priority: 'issues.groupByPriority',
  status: 'issues.groupByStatus',
};

const ORDER_LABEL_KEYS: Record<ListOrderBy, string> = {
  created: 'issues.orderByCreated',
  dueDate: 'issues.orderByDueDate',
  manual: 'issues.orderByManual',
  priority: 'issues.orderByPriority',
  updated: 'issues.orderByUpdated',
};

/**
 * The list view's "group by" + "order by" pair, the list counterpart of
 * `BoardControls`. Rendered in the page header's action strip.
 */
export function ListDisplayControls({
  groupBy,
  onGroupBy,
  onOrderBy,
  orderBy,
}: ListDisplayControlsProps) {
  const t = useTranslations();
  return (
    <>
      <SimpleSelect
        ariaLabel={t('issues.groupByLabel')}
        onChange={value => onGroupBy(value as ListGroupBy)}
        options={GROUP_VALUES.map(value => ({ label: t(GROUP_LABEL_KEYS[value]), value }))}
        value={groupBy}
        variant="ghost"
      />
      <SimpleSelect
        ariaLabel={t('issues.orderByLabel')}
        onChange={value => onOrderBy(value as ListOrderBy)}
        options={ORDER_VALUES.map(value => ({ label: t(ORDER_LABEL_KEYS[value]), value }))}
        value={orderBy}
        variant="ghost"
      />
    </>
  );
}
