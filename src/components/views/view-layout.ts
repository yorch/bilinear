import type { BoardGroupBy } from '@/components/issues/board-view';
import type { ListGroupBy } from '@/components/issues/issue-list-view';
import type { ViewMode } from '@/components/issues/view-toggle';
import type { SortField } from '@/lib/filter-engine';

/** A saved view's stored `layout` string narrowed to the modes the list pages render. */
export function coerceViewMode(layout: string | null | undefined): ViewMode {
  return layout === 'board' || layout === 'timeline' ? layout : 'list';
}

/** A saved view's stored `groupBy` string narrowed to the board groupings. */
export function coerceBoardGroupBy(groupBy: string | null | undefined): BoardGroupBy {
  return groupBy === 'assignee' || groupBy === 'priority' ? groupBy : 'status';
}

/** A saved view's stored `groupBy` narrowed to the list groupings. */
export function coerceListGroupBy(groupBy: string | null | undefined): ListGroupBy {
  return groupBy === 'assignee' || groupBy === 'priority' || groupBy === 'none'
    ? groupBy
    : 'status';
}

/** The list's "Order by" choices. `manual` is the team's own drag order (no stored sort). */
export type ListOrderBy = 'manual' | 'priority' | 'updated' | 'created' | 'dueDate';

const ORDER_DIRECTION: Record<Exclude<ListOrderBy, 'manual'>, SortField['direction']> = {
  created: 'desc',
  dueDate: 'asc',
  priority: 'asc',
  updated: 'desc',
};

/** Order choice -> the `SortField[]` that is stored on a saved view and fed to `applySorting`. */
export function orderByToSort(order: ListOrderBy): SortField[] {
  return order === 'manual' ? [] : [{ direction: ORDER_DIRECTION[order], field: order }];
}

/** Stored sort -> the order choice (first recognised field wins; anything else is manual). */
export function sortToOrderBy(sort: SortField[]): ListOrderBy {
  const first = sort[0];
  if (
    first &&
    (first.field === 'priority' ||
      first.field === 'updated' ||
      first.field === 'created' ||
      first.field === 'dueDate')
  ) {
    return first.field;
  }
  return 'manual';
}
