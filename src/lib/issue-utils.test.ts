import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDueDate,
  getDueDateColor,
  getPriorityConfig,
  PRIORITY_CONFIG,
  PRIORITY_OPTIONS,
} from './issue-utils';

describe('priority constants', () => {
  it('carries no display label — those come from the dictionary', () => {
    // An English `label` here would render untranslated wherever a component
    // reached for it instead of `t(priorityLabelKey(p))`, which is exactly how
    // the priority context submenu shipped English-only.
    for (const config of Object.values(PRIORITY_CONFIG)) {
      expect(config).not.toHaveProperty('label');
    }
    for (const option of PRIORITY_OPTIONS) {
      expect(option).not.toHaveProperty('label');
    }
  });

  it('gives every level a distinct SHAPE, not just a distinct colour', () => {
    // PriorityIcon draws `bars` filled bars, or a square when `urgent`. If two
    // levels share a shape they are told apart by colour alone, which fails
    // WCAG 1.4.1 and makes the ramp unreadable in greyscale. Note that
    // urgent(1) and high(2) both carry bars:3 — `urgent` is what separates
    // them, so dropping the flag from the key must fail this test.
    const shapes = Object.values(PRIORITY_CONFIG).map(c => `${c.bars}:${c.urgent}`);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('carries no glyph string — the icon is drawn, not typed', () => {
    // ASCII glyphs ('!!!', '·') cannot be sized to a box, so the priority cell
    // was a different width on every row and re-ragged the whole issue list.
    for (const config of Object.values(PRIORITY_CONFIG)) {
      expect(config).not.toHaveProperty('icon');
    }
  });

  it('PRIORITY_OPTIONS exposes string values for every priority', () => {
    expect(PRIORITY_OPTIONS).toEqual([
      { value: '0' },
      { value: '1' },
      { value: '2' },
      { value: '3' },
      { value: '4' },
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
    expect(getDueDateColor('2026-06-10T12:00:00')).toBe('text-danger-subtle-foreground');
  });

  it('returns the high-contrast warning when due today', () => {
    expect(getDueDateColor('2026-06-15T12:00:00')).toBe('text-warning-subtle-foreground');
  });

  it('returns a distinct, less urgent warning when due within three days', () => {
    // Must not equal the "due today" class — these are separate urgency levels.
    expect(getDueDateColor('2026-06-17T12:00:00')).toBe('text-warning');
    expect(getDueDateColor('2026-06-17T12:00:00')).not.toBe(getDueDateColor('2026-06-15T12:00:00'));
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
