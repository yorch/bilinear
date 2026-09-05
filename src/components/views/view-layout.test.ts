import { describe, expect, it } from 'vitest';
import { coerceBoardGroupBy, coerceViewMode } from './view-layout';

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
