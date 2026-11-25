import type { FilterCondition, FilterField, FilterOperator, FilterSet } from './filter-engine';

/**
 * Structural validation of an untrusted `CustomView.filters` value.
 *
 * The column is bare JSON, and a *shared* view is read by every member of the
 * org — including the server-side Insights scan — so a malformed one must be
 * rejected up front rather than crash (`{conditions:[null]}`) or stall the
 * event loop (hundreds of conditions x thousands of values) the code that
 * reads it. The caps are generous for any human-built view.
 */
export const MAX_FILTER_CONDITIONS = 50;
export const MAX_FILTER_VALUES = 200;
export const MAX_FILTER_STRING = 256;

const FIELDS: ReadonlySet<string> = new Set<FilterField>([
  'status',
  'assignee',
  'creator',
  'label',
  'priority',
  'project',
  'cycle',
  'estimate',
  'dueDate',
  'createdAt',
  'updatedAt',
  'custom',
]);

const OPERATORS: ReadonlySet<string> = new Set<FilterOperator>([
  'eq',
  'neq',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_set',
  'is_not_set',
  'before',
  'after',
  'overdue',
]);

/** The only top-level keys a stored filter set may carry. */
const FILTER_SET_KEYS: ReadonlySet<string> = new Set(['composition', 'conditions']);

export type FilterValidation = { error: string; ok: false } | { ok: true; set: FilterSet };

function validScalar(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= MAX_FILTER_STRING)
  );
}

/**
 * Returns a cleaned `FilterSet`, or why the value is unusable. `null`,
 * `undefined` and `{}` (the column default) are the empty filter.
 */
export function validateFilterSet(value: unknown): FilterValidation {
  if (value === null || value === undefined) {
    return { ok: true, set: { composition: 'and', conditions: [] } };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'filters must be an object', ok: false };
  }
  // Reject foreign top-level keys (`{s2:"x"}`): they would be persisted verbatim
  // in a column every viewer of a shared view reads, and nothing consumes them.
  const unknownKey = Object.keys(value).find(k => !FILTER_SET_KEYS.has(k));
  if (unknownKey !== undefined) {
    return { error: `unknown filter key: ${unknownKey.slice(0, 40)}`, ok: false };
  }
  const { composition, conditions } = value as { composition?: unknown; conditions?: unknown };
  if (conditions === undefined) {
    return { ok: true, set: { composition: 'and', conditions: [] } };
  }
  if (!Array.isArray(conditions)) {
    return { error: 'filters.conditions must be an array', ok: false };
  }
  if (conditions.length > MAX_FILTER_CONDITIONS) {
    return { error: `filters has more than ${MAX_FILTER_CONDITIONS} conditions`, ok: false };
  }
  if (composition !== undefined && composition !== 'and' && composition !== 'or') {
    return { error: 'filters.composition must be "and" or "or"', ok: false };
  }
  const clean: FilterCondition[] = [];
  for (const raw of conditions) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { error: 'every filter condition must be an object', ok: false };
    }
    const c = raw as Record<string, unknown>;
    if (typeof c.field !== 'string' || !FIELDS.has(c.field)) {
      return { error: `unknown filter field: ${String(c.field).slice(0, 40)}`, ok: false };
    }
    if (typeof c.operator !== 'string' || !OPERATORS.has(c.operator)) {
      return { error: `unknown filter operator: ${String(c.operator).slice(0, 40)}`, ok: false };
    }
    const v = c.value;
    if (Array.isArray(v)) {
      if (v.length > MAX_FILTER_VALUES || !v.every(validScalar)) {
        return { error: 'filter value list is too long or has non-scalar items', ok: false };
      }
    } else if (v !== undefined && !validScalar(v)) {
      return { error: 'filter value must be a scalar or a list of scalars', ok: false };
    }
    if (
      c.customFieldId !== undefined &&
      (typeof c.customFieldId !== 'string' || c.customFieldId.length > MAX_FILTER_STRING)
    ) {
      return { error: 'filter customFieldId must be a short string', ok: false };
    }
    clean.push({
      ...(c.customFieldId === undefined ? {} : { customFieldId: c.customFieldId as string }),
      field: c.field as FilterField,
      operator: c.operator as FilterOperator,
      ...(v === undefined ? {} : { value: v as FilterCondition['value'] }),
    });
  }
  return { ok: true, set: { composition: composition === 'or' ? 'or' : 'and', conditions: clean } };
}

export interface SanitizedFilterSet {
  /** Conditions discarded because they were malformed. */
  dropped: number;
  /** `null` when the stored value is not even an object: nothing to salvage. */
  set: FilterSet | null;
}

/**
 * Lenient read of a STORED filter set. A shared view is read by the whole org,
 * so one bad row must neither crash the reader nor silently become "no filter"
 * (which would widen what the view shows): keep every condition that validates,
 * drop and count the ones that do not, and let the caller log the count.
 * A value that is not even an object has nothing salvageable: `set` is null
 * and the caller must refuse rather than guess.
 */
export function sanitizeStoredFilterSet(value: unknown): SanitizedFilterSet {
  const whole = validateFilterSet(value);
  if (whole.ok) {
    return { dropped: 0, set: whole.set };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { dropped: 1, set: null };
  }
  const { composition, conditions } = value as { composition?: unknown; conditions?: unknown };
  const list = Array.isArray(conditions) ? conditions.slice(0, MAX_FILTER_CONDITIONS) : [];
  const kept: FilterCondition[] = [];
  let dropped = Array.isArray(conditions) ? conditions.length - list.length : 1;
  for (const raw of list) {
    const one = validateFilterSet({ conditions: [raw] });
    if (one.ok && one.set.conditions[0]) {
      kept.push(one.set.conditions[0]);
    } else {
      dropped += 1;
    }
  }
  return {
    dropped,
    set: { composition: composition === 'or' ? 'or' : 'and', conditions: kept },
  };
}
