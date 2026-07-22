import { describe, expect, it } from 'vitest';
import {
  applyStatusTransitionTimestamps,
  type StatusTimestampTransition,
} from './status-timestamps';

const TABLE: Record<'planned' | 'active' | 'completed' | 'canceled', StatusTimestampTransition> = {
  active: { canceledAt: 'clear', completedAt: 'clear', startedAt: 'now' },
  canceled: { canceledAt: 'now', completedAt: 'clear', startedAt: 'leave' },
  completed: { canceledAt: 'clear', completedAt: 'now', startedAt: 'leave' },
  planned: { canceledAt: 'clear', completedAt: 'clear', startedAt: 'clear' },
};

describe('applyStatusTransitionTimestamps', () => {
  const now = new Date('2026-07-15T00:00:00Z');

  it('stamps `now` for an op marked "now"', () => {
    const patch = applyStatusTransitionTimestamps(TABLE, 'active', now);
    expect(patch).toEqual({ canceledAt: null, completedAt: null, startedAt: now });
  });

  it('clears every column marked "clear"', () => {
    const patch = applyStatusTransitionTimestamps(TABLE, 'planned', now);
    expect(patch).toEqual({ canceledAt: null, completedAt: null, startedAt: null });
  });

  it('leaves untouched columns as undefined (no-op in a Prisma partial update)', () => {
    const patch = applyStatusTransitionTimestamps(TABLE, 'canceled', now);
    expect(patch).toEqual({ canceledAt: now, completedAt: null, startedAt: undefined });
  });

  it('returns an empty patch when the status has no table entry', () => {
    const patch = applyStatusTransitionTimestamps(
      TABLE as Partial<typeof TABLE>,
      'backlog' as never,
      now,
    );
    expect(patch).toEqual({});
  });
});
