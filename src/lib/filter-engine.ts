/**
 * Client-side filter engine for issues.
 * Filters are applied to the MobX store's issue pool — no server round-trip.
 */

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_set'
  | 'is_not_set';

export type FilterField =
  | 'status'
  | 'assignee'
  | 'creator'
  | 'label'
  | 'priority'
  | 'project'
  | 'cycle'
  | 'estimate'
  | 'dueDate'
  | 'createdAt'
  | 'updatedAt'
  | 'custom';

export interface FilterCondition {
  /** Set when `field === 'custom'` — identifies which custom field to match. */
  customFieldId?: string;
  field: FilterField;
  operator: FilterOperator;
  value?: string | string[] | number | boolean | null;
}

export type FilterComposition = 'and' | 'or';

export interface FilterSet {
  composition: FilterComposition;
  conditions: FilterCondition[];
}

export interface SortField {
  direction: 'asc' | 'desc';
  field: 'priority' | 'status' | 'assignee' | 'created' | 'updated' | 'dueDate' | 'manual';
}

export interface ViewConfig {
  filters: FilterSet;
  groupBy?: string;
  layout?: 'list' | 'board';
  sort: SortField[];
}

export interface FilterableIssue {
  assigneeId?: string | null;
  createdAt?: string;
  creatorId?: string | null;
  cycleId?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  id: string;
  labelIds?: string[];
  priority: number;
  projectId?: string | null;
  sortOrder?: number;
  stateId: string;
  updatedAt?: string;
}

/** Resolves an issue's value for a given custom-field definition id. */
export type CustomFieldValueResolver = (issueId: string, definitionId: string) => unknown;

function matchCondition(
  issue: FilterableIssue,
  condition: FilterCondition,
  customFieldResolver?: CustomFieldValueResolver,
): boolean {
  const { field, operator, value } = condition;

  const fieldValue =
    field === 'custom' && condition.customFieldId
      ? (customFieldResolver?.(issue.id, condition.customFieldId) ?? null)
      : getFieldValue(issue, field);

  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'neq':
      return fieldValue !== value;
    case 'in':
      if (Array.isArray(value)) {
        if (field === 'label') {
          // For labels, check if the issue has any of the specified labels
          const issueLabels = issue.labelIds ?? [];
          return value.some(v => issueLabels.includes(v));
        }
        if (Array.isArray(fieldValue)) {
          // Custom multi_select — match if any selected value overlaps
          return value.some(v => (fieldValue as unknown[]).includes(v));
        }
        return value.includes(String(fieldValue));
      }
      return false;
    case 'nin':
      if (Array.isArray(value)) {
        if (field === 'label') {
          const issueLabels = issue.labelIds ?? [];
          return !value.some(v => issueLabels.includes(v));
        }
        if (Array.isArray(fieldValue)) {
          return !value.some(v => (fieldValue as unknown[]).includes(v));
        }
        return !value.includes(String(fieldValue));
      }
      return false;
    case 'gt':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue > value
        : String(fieldValue) > String(value);
    case 'gte':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue >= value
        : String(fieldValue) >= String(value);
    case 'lt':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue < value
        : String(fieldValue) < String(value);
    case 'lte':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue <= value
        : String(fieldValue) <= String(value);
    case 'is_set':
      return fieldValue !== null && fieldValue !== undefined;
    case 'is_not_set':
      return fieldValue === null || fieldValue === undefined;
    default:
      return true;
  }
}

function getFieldValue(
  issue: FilterableIssue,
  field: FilterField,
): string | number | null | undefined {
  switch (field) {
    case 'status':
      return issue.stateId;
    case 'assignee':
      return issue.assigneeId ?? null;
    case 'creator':
      return issue.creatorId ?? null;
    case 'priority':
      return issue.priority;
    case 'estimate':
      return issue.estimate ?? null;
    case 'dueDate':
      return issue.dueDate ?? null;
    case 'project':
      return issue.projectId ?? null;
    case 'cycle':
      return issue.cycleId ?? null;
    case 'label':
      // Handled specially in matchCondition
      return (issue.labelIds ?? []).join(',') || null;
    case 'createdAt':
      return issue.createdAt;
    case 'updatedAt':
      return issue.updatedAt;
    default:
      return null;
  }
}

export function applyFilters<T extends FilterableIssue>(
  issues: T[],
  filterSet: FilterSet,
  customFieldResolver?: CustomFieldValueResolver,
): T[] {
  // Defensive: persisted CustomView.filters is unvalidated JSON, so a stored
  // `{}` (the server default) must not crash the engine.
  if (!filterSet?.conditions?.length) {
    return issues;
  }

  return issues.filter(issue => {
    if (filterSet.composition === 'and') {
      return filterSet.conditions.every(c => matchCondition(issue, c, customFieldResolver));
    }
    return filterSet.conditions.some(c => matchCondition(issue, c, customFieldResolver));
  });
}

export function applySorting<T extends FilterableIssue>(
  issues: T[],
  sortFields: SortField[],
  statePositionMap?: Map<string, number>,
): T[] {
  if (sortFields.length === 0) {
    return issues;
  }

  return [...issues].sort((a, b) => {
    for (const { field, direction } of sortFields) {
      const multiplier = direction === 'asc' ? 1 : -1;
      let cmp = 0;

      switch (field) {
        case 'priority':
          cmp = a.priority - b.priority;
          break;
        case 'status':
          cmp = (statePositionMap?.get(a.stateId) ?? 0) - (statePositionMap?.get(b.stateId) ?? 0);
          break;
        case 'created':
          cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
          break;
        case 'updated':
          cmp = (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
          break;
        case 'dueDate': {
          const ad = a.dueDate ?? '\uffff';
          const bd = b.dueDate ?? '\uffff';
          cmp = ad.localeCompare(bd);
          break;
        }
        case 'manual':
          cmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          break;
        case 'assignee':
          cmp = (a.assigneeId ?? '').localeCompare(b.assigneeId ?? '');
          break;
      }

      if (cmp !== 0) {
        return cmp * multiplier;
      }
    }
    return 0;
  });
}

export function createEmptyFilterSet(): FilterSet {
  return { composition: 'and', conditions: [] };
}

/**
 * Normalize an untyped stored value (CustomView.filters is persisted as bare
 * JSON with no server-side shape validation) into a safe FilterSet.
 */
const SORT_FIELDS: ReadonlySet<SortField['field']> = new Set([
  'assignee',
  'created',
  'dueDate',
  'manual',
  'priority',
  'status',
  'updated',
]);

/**
 * Normalize a stored `CustomView.sort` (bare JSON, like `filters`) into the
 * `SortField[]` `applySorting` accepts. An entry with an unknown field or
 * direction is dropped rather than letting `applySorting` fall through to
 * "no comparison", which would silently leave the list in insertion order.
 */
export function coerceSortFields(value: unknown): SortField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SortField[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { direction, field } = entry as Partial<SortField>;
    if (
      (direction === 'asc' || direction === 'desc') &&
      typeof field === 'string' &&
      SORT_FIELDS.has(field as SortField['field'])
    ) {
      out.push({ direction, field: field as SortField['field'] });
    }
  }
  return out;
}

export function coerceFilterSet(value: unknown): FilterSet {
  const v = value as Partial<FilterSet> | null | undefined;
  if (v && Array.isArray(v.conditions)) {
    return { composition: v.composition === 'or' ? 'or' : 'and', conditions: v.conditions };
  }
  return createEmptyFilterSet();
}
