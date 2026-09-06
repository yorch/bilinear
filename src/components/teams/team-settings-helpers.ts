import type { DBTeam } from '@/lib/db';

/**
 * Pure helpers behind the team-settings cards. Kept free of React so the
 * option tables and the reorder/parse logic can be unit-tested directly.
 */

export const ESTIMATION_TYPES = [
  'notUsed',
  'exponential',
  'fibonacci',
  'linear',
  'tShirt',
] as const;
export type EstimationType = (typeof ESTIMATION_TYPES)[number];

export const WORKFLOW_STATE_TYPES = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const;
export type WorkflowStateType = (typeof WORKFLOW_STATE_TYPES)[number];

/**
 * Weekday indexes for the cycle start-day select, Monday first (JS `getDay()`
 * numbering: 0 = Sunday). The server accepts 0–6.
 */
export const WEEKDAY_INDEXES = [1, 2, 3, 4, 5, 6, 0] as const;
export type WeekdayIndex = (typeof WEEKDAY_INDEXES)[number];

/** Server-enforced ranges for the numeric team knobs. */
export const CYCLE_DURATION_RANGE = { max: 8, min: 1 } as const;
export const CYCLE_COOLDOWN_RANGE = { max: 4, min: 0 } as const;
export const AUTO_PERIOD_RANGE = { max: 24, min: 1 } as const;

/**
 * The optional/nullable `Team` columns behind the settings cards, normalised
 * to their Prisma defaults so the form never seeds from `undefined`.
 */
export interface TeamExtras {
  autoArchivePeriod: number | null;
  autoCloseChildIssues: boolean;
  autoCloseParentIssues: boolean;
  autoClosePeriod: number | null;
  cycleCooldownTime: number;
  cycleDuration: number;
  cycleStartDay: number;
  defaultIssueStateId: string | null;
}

export function readTeamExtras(team: DBTeam | null | undefined): TeamExtras {
  return {
    autoArchivePeriod: team?.autoArchivePeriod ?? null,
    autoCloseChildIssues: team?.autoCloseChildIssues ?? false,
    autoCloseParentIssues: team?.autoCloseParentIssues ?? false,
    autoClosePeriod: team?.autoClosePeriod ?? null,
    cycleCooldownTime: team?.cycleCooldownTime ?? 0,
    cycleDuration: team?.cycleDuration ?? 2,
    cycleStartDay: team?.cycleStartDay ?? 1,
    defaultIssueStateId: team?.defaultIssueStateId ?? null,
  };
}

/**
 * Parse a whole number and check it against an inclusive range. Empty input
 * is `null` (unset); anything else outside the range or non-integer is
 * `undefined` so the caller blocks the save.
 */
export function parseIntInRange(
  raw: string,
  range: { max: number; min: number },
): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const n = Number(trimmed);
  return n >= range.min && n <= range.max ? n : undefined;
}

/**
 * Parse an optional positive-integer text field. Empty (or whitespace) means
 * "unset" → `null`; anything non-numeric, zero or negative is rejected as
 * `undefined` so the caller can block the save instead of silently sending 0.
 */
export function parseOptionalPositiveInt(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const n = Number(trimmed);
  return n > 0 ? n : undefined;
}

/**
 * IANA zone list for the timezone select. `Intl.supportedValuesOf` is missing
 * on older runtimes (and jsdom), so fall back to UTC — and always include the
 * team's current zone so a saved value never renders as "none selected".
 */
export function listTimezones(current?: string | null): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[] = [];
  try {
    zones = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  const set = new Set<string>(zones.length > 0 ? zones : ['UTC']);
  set.add('UTC');
  if (current) {
    set.add(current);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export interface Positioned {
  id: string;
  position: number;
}

/**
 * Move the item at `index` one step in `direction` inside an already-sorted
 * list. Returns the two `{ id, position }` writes needed (positions swapped),
 * or `null` when the move is a no-op (already first/last). When two rows share
 * a position — legacy data created with the default `0` — swapping would not
 * change the order, so the moved row takes the neighbour's position ± 1
 * instead.
 */
export function swapAdjacent<T extends Positioned>(
  sorted: readonly T[],
  index: number,
  direction: 'up' | 'down',
): [Positioned, Positioned] | null {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= sorted.length || target < 0 || target >= sorted.length) {
    return null;
  }
  const a = sorted[index];
  const b = sorted[target];
  if (a.position === b.position) {
    const shift = direction === 'up' ? -1 : 1;
    return [
      { id: a.id, position: b.position + shift },
      { id: b.id, position: b.position },
    ];
  }
  return [
    { id: a.id, position: b.position },
    { id: b.id, position: a.position },
  ];
}

export function nextPosition(items: readonly Positioned[]): number {
  return items.reduce((max, s) => Math.max(max, s.position), 0) + 1;
}

/** `yyyy-mm-dd` (local) for an ISO timestamp, for `<input type="date">`. */
export function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Local-midnight ISO timestamp for a `yyyy-mm-dd` input value, or `null` when
 * the field is empty/malformed. `endOfDay` pins the end date to 23:59:59.999
 * so a one-day cycle still has `endsAt > startsAt` for the server check.
 */
export function fromDateInputValue(value: string, endOfDay = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    return null;
  }
  const d = endOfDay
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
