import type { BoardGroupBy } from '@/components/issues/board-view';
import type { ViewMode } from '@/components/issues/view-toggle';

/** A saved view's stored `layout` string narrowed to the modes the list pages render. */
export function coerceViewMode(layout: string | null | undefined): ViewMode {
  return layout === 'board' || layout === 'timeline' ? layout : 'list';
}

/** A saved view's stored `groupBy` string narrowed to the board groupings. */
export function coerceBoardGroupBy(groupBy: string | null | undefined): BoardGroupBy {
  return groupBy === 'assignee' || groupBy === 'priority' ? groupBy : 'status';
}
