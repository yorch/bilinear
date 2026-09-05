import { describe, expect, it } from 'vitest';
import {
  fromDateInputValue,
  listTimezones,
  nextPosition,
  parseIntInRange,
  parseOptionalPositiveInt,
  readTeamExtras,
  swapAdjacent,
  toDateInputValue,
  WEEKDAY_INDEXES,
} from './team-settings-helpers';

describe('parseOptionalPositiveInt', () => {
  it('treats empty input as unset (null) rather than a rejected value', () => {
    expect(parseOptionalPositiveInt('')).toBeNull();
    expect(parseOptionalPositiveInt('   ')).toBeNull();
  });

  it('accepts positive whole numbers', () => {
    expect(parseOptionalPositiveInt('3')).toBe(3);
    expect(parseOptionalPositiveInt(' 12 ')).toBe(12);
  });

  it('rejects zero, negatives, decimals and text', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '2e3']) {
      expect(parseOptionalPositiveInt(bad)).toBeUndefined();
    }
  });
});

describe('readTeamExtras', () => {
  it('falls back to the Prisma defaults when the row lacks the columns', () => {
    expect(readTeamExtras(null)).toEqual({
      autoArchivePeriod: null,
      autoCloseChildIssues: false,
      autoCloseParentIssues: false,
      autoClosePeriod: null,
      cycleCooldownTime: 0,
      cycleDuration: 2,
      cycleStartDay: 1,
      defaultIssueStateId: null,
    });
  });

  it('reads the columns when the row carries them', () => {
    const team = {
      autoClosePeriod: 6,
      cycleDuration: 3,
      defaultIssueStateId: 'st-1',
    } as unknown as Parameters<typeof readTeamExtras>[0];
    expect(readTeamExtras(team)).toMatchObject({
      autoClosePeriod: 6,
      cycleDuration: 3,
      defaultIssueStateId: 'st-1',
    });
  });
});

describe('listTimezones', () => {
  it('always contains UTC and the current zone, sorted', () => {
    const zones = listTimezones('Zzz/Custom');
    expect(zones).toContain('UTC');
    expect(zones).toContain('Zzz/Custom');
    expect(zones).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('swapAdjacent', () => {
  const sorted = [
    { id: 'a', position: 1 },
    { id: 'b', position: 2 },
    { id: 'c', position: 3 },
  ];

  it('returns null at the boundaries', () => {
    expect(swapAdjacent(sorted, 0, 'up')).toBeNull();
    expect(swapAdjacent(sorted, 2, 'down')).toBeNull();
    expect(swapAdjacent(sorted, 5, 'up')).toBeNull();
  });

  it('swaps positions with the neighbour', () => {
    expect(swapAdjacent(sorted, 1, 'up')).toEqual([
      { id: 'b', position: 1 },
      { id: 'a', position: 2 },
    ]);
    expect(swapAdjacent(sorted, 1, 'down')).toEqual([
      { id: 'b', position: 3 },
      { id: 'c', position: 2 },
    ]);
  });

  it('breaks a tie instead of writing a no-op swap', () => {
    const tied = [
      { id: 'a', position: 0 },
      { id: 'b', position: 0 },
    ];
    const writes = swapAdjacent(tied, 1, 'up');
    expect(writes).not.toBeNull();
    const [moved, neighbour] = writes as NonNullable<typeof writes>;
    expect(moved.id).toBe('b');
    expect(moved.position).toBeLessThan(neighbour.position);
  });
});

describe('nextPosition', () => {
  it('is one past the current maximum, and 1 for an empty list', () => {
    expect(nextPosition([])).toBe(1);
    expect(
      nextPosition([
        { id: 'a', position: 4 },
        { id: 'b', position: 9 },
      ]),
    ).toBe(10);
  });
});

describe('date input helpers', () => {
  it('round-trips a local calendar day', () => {
    const iso = fromDateInputValue('2026-03-15');
    expect(iso).not.toBeNull();
    expect(toDateInputValue(iso as string)).toBe('2026-03-15');
  });

  it('pins the end of day so a one-day range is still ordered', () => {
    const start = fromDateInputValue('2026-03-15') as string;
    const end = fromDateInputValue('2026-03-15', true) as string;
    expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
  });

  it('rejects malformed input', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(fromDateInputValue('15/03/2026')).toBeNull();
    expect(toDateInputValue('not-a-date')).toBe('');
  });
});

describe('parseIntInRange', () => {
  const range = { max: 4, min: 0 };
  it('accepts the bounds and rejects outside them', () => {
    expect(parseIntInRange('0', range)).toBe(0);
    expect(parseIntInRange('4', range)).toBe(4);
    expect(parseIntInRange('5', range)).toBeUndefined();
    expect(parseIntInRange('-1', range)).toBeUndefined();
    expect(parseIntInRange('2.5', range)).toBeUndefined();
  });
  it('treats empty as unset', () => {
    expect(parseIntInRange(' ', range)).toBeNull();
  });
});

describe('readTeamExtras (server-backed columns)', () => {
  it('reads every column when present', () => {
    const team = {
      autoArchivePeriod: 12,
      autoCloseChildIssues: true,
      autoCloseParentIssues: false,
      autoClosePeriod: 6,
      cycleCooldownTime: 1,
      cycleDuration: 3,
      cycleStartDay: 0,
      defaultIssueStateId: 'st-1',
    } as unknown as Parameters<typeof readTeamExtras>[0];
    expect(readTeamExtras(team)).toEqual({
      autoArchivePeriod: 12,
      autoCloseChildIssues: true,
      autoCloseParentIssues: false,
      autoClosePeriod: 6,
      cycleCooldownTime: 1,
      cycleDuration: 3,
      cycleStartDay: 0,
      defaultIssueStateId: 'st-1',
    });
  });

  it('normalises null columns to the Prisma defaults', () => {
    const team = {
      cycleCooldownTime: null,
      cycleDuration: null,
      cycleStartDay: null,
    } as unknown as Parameters<typeof readTeamExtras>[0];
    expect(readTeamExtras(team)).toMatchObject({
      autoCloseChildIssues: false,
      cycleCooldownTime: 0,
      cycleDuration: 2,
      cycleStartDay: 1,
    });
  });
});

describe('WEEKDAY_INDEXES', () => {
  it('covers all seven days exactly once, Monday first', () => {
    expect([...WEEKDAY_INDEXES].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(WEEKDAY_INDEXES[0]).toBe(1);
  });
});
