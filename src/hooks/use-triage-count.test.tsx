import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countActiveTriage, useTriageCount } from './use-triage-count';

describe('countActiveTriage', () => {
  it('skips snoozed issues and non-triage states', () => {
    const triage = new Set(['tri']);
    const now = Date.parse('2026-01-01T00:00:00Z');
    const issues = [
      { stateId: 'tri' },
      { snoozedUntilAt: '2026-01-02T00:00:00Z', stateId: 'tri' },
      { snoozedUntilAt: '2025-12-31T00:00:00Z', stateId: 'tri' },
      { stateId: 'todo' },
    ];
    expect(countActiveTriage(issues, triage, now)).toBe(2);
  });
});

describe('useTriageCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('re-renders when a snooze expires, with no other state change', () => {
    const triage = new Set(['tri']);
    const issues = [{ stateId: 'tri' }, { snoozedUntilAt: '2026-01-01T00:10:00Z', stateId: 'tri' }];
    const { result } = renderHook(() => useTriageCount(issues, triage, true));
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });
    expect(result.current).toBe(2);
  });

  it('is 0 when triage is off', () => {
    const { result } = renderHook(() =>
      useTriageCount([{ stateId: 'tri' }], new Set(['tri']), false),
    );
    expect(result.current).toBe(0);
  });
});
