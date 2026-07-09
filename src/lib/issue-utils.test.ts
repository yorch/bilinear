import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDueDate,
  getDueDateColor,
  getPriorityConfig,
  PRIORITY_CONFIG,
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
} from './issue-utils';

describe('priority constants', () => {
  it('PRIORITY_LABELS mirrors PRIORITY_CONFIG labels', () => {
    expect(PRIORITY_LABELS).toEqual({
      0: 'No priority',
      1: 'Urgent',
      2: 'High',
      3: 'Medium',
      4: 'Low',
    });
  });

  it('PRIORITY_OPTIONS exposes string values for every priority', () => {
    expect(PRIORITY_OPTIONS).toEqual([
      { label: 'No priority', value: '0' },
      { label: 'Urgent', value: '1' },
      { label: 'High', value: '2' },
      { label: 'Medium', value: '3' },
      { label: 'Low', value: '4' },
    ]);
  });
});

describe('getPriorityConfig', () => {
  it('returns the config for a valid priority', () => {
    expect(getPriorityConfig(1)).toBe(PRIORITY_CONFIG[1]);
  });

  it('falls back to "No priority" for an out-of-range value', () => {
    expect(getPriorityConfig(99)).toBe(PRIORITY_CONFIG[0]);
    expect(getPriorityConfig(-1)).toBe(PRIORITY_CONFIG[0]);
  });
});

describe('getDueDateColor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Local-time noon (no trailing Z) keeps date math timezone-independent.
    vi.setSystemTime(new Date('2026-06-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the neutral color when there is no due date', () => {
    expect(getDueDateColor(null)).toBe('text-muted-foreground');
    expect(getDueDateColor(undefined)).toBe('text-muted-foreground');
  });

  it('returns red for an overdue date', () => {
    expect(getDueDateColor('2026-06-10T12:00:00')).toBe('text-red-500');
  });

  it('returns orange when due today', () => {
    expect(getDueDateColor('2026-06-15T12:00:00')).toBe('text-orange-500');
  });

  it('returns yellow when due within three days', () => {
    expect(getDueDateColor('2026-06-17T12:00:00')).toBe('text-yellow-500');
  });

  it('returns neutral when due more than three days out', () => {
    expect(getDueDateColor('2026-06-25T12:00:00')).toBe('text-muted-foreground');
  });
});

describe('formatDueDate', () => {
  it('returns an empty string for no date', () => {
    expect(formatDueDate(null)).toBe('');
    expect(formatDueDate(undefined)).toBe('');
  });

  it('formats a date as "MMM d"', () => {
    expect(formatDueDate('2026-06-15T12:00:00')).toBe('Jun 15');
    expect(formatDueDate('2026-01-03T12:00:00')).toBe('Jan 3');
  });
});
