import { describe, expect, it } from 'vitest';
import {
  coerceBoardGroupBy,
  coerceListGroupBy,
  coerceViewMode,
  orderByToSort,
  sortToOrderBy,
} from './view-layout';

describe('view-layout coercion', () => {
  it('passes the renderable layouts through and falls back to list', () => {
    expect(coerceViewMode('board')).toBe('board');
    expect(coerceViewMode('timeline')).toBe('timeline');
    expect(coerceViewMode('list')).toBe('list');
    expect(coerceViewMode('gallery')).toBe('list');
    expect(coerceViewMode(null)).toBe('list');
    expect(coerceViewMode(undefined)).toBe('list');
  });

  it('passes the board groupings through and falls back to status', () => {
    expect(coerceBoardGroupBy('assignee')).toBe('assignee');
    expect(coerceBoardGroupBy('priority')).toBe('priority');
    expect(coerceBoardGroupBy('status')).toBe('status');
    expect(coerceBoardGroupBy('label')).toBe('status');
    expect(coerceBoardGroupBy(null)).toBe('status');
  });
});

describe('list display helpers', () => {
  it('narrows a stored groupBy to the list groupings', () => {
    expect(coerceListGroupBy('none')).toBe('none');
    expect(coerceListGroupBy('priority')).toBe('priority');
    expect(coerceListGroupBy('label')).toBe('status');
    expect(coerceListGroupBy(null)).toBe('status');
  });

  it('round-trips every order choice through the stored sort', () => {
    for (const order of ['manual', 'priority', 'updated', 'created', 'dueDate'] as const) {
      expect(sortToOrderBy(orderByToSort(order))).toBe(order);
    }
    expect(orderByToSort('manual')).toEqual([]);
    expect(orderByToSort('updated')).toEqual([{ direction: 'desc', field: 'updated' }]);
    expect(sortToOrderBy([{ direction: 'asc', field: 'assignee' }])).toBe('manual');
  });
});
