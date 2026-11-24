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
