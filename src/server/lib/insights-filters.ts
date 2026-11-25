import type { Prisma } from '../../generated/prisma';
import type { FilterCondition, FilterSet } from '../../lib/filter-engine';

/**
 * Translate a validated saved-view `FilterSet` into a Prisma `where`, so the
 * database narrows the rows BEFORE the scan cap and nothing is filtered in JS.
 * Semantics mirror `lib/filter-engine` (an unset value matches only an explicit
 * `null` target; `neq`/`nin` are negations; labels use set semantics).
 */
export class UnsupportedFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFilterError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_MATCH: Prisma.IssueWhereInput = { id: { in: [] } };

type ScalarKind = 'uuid' | 'number' | 'date' | 'timestamp';

interface FieldSpec {
  column: 'assigneeId' | 'creatorId' | 'cycleId' | 'projectId' | 'stateId';
  kind: 'uuid';
  nullable: boolean;
}

const UUID_FIELDS: Record<string, FieldSpec> = {
  assignee: { column: 'assigneeId', kind: 'uuid', nullable: true },
  creator: { column: 'creatorId', kind: 'uuid', nullable: true },
  cycle: { column: 'cycleId', kind: 'uuid', nullable: true },
  project: { column: 'projectId', kind: 'uuid', nullable: true },
  status: { column: 'stateId', kind: 'uuid', nullable: false },
};

const NUMBER_FIELDS: Record<string, { column: 'estimate' | 'priority'; nullable: boolean }> = {
  estimate: { column: 'estimate', nullable: true },
  priority: { column: 'priority', nullable: false },
};

const DATE_FIELDS: Record<
  string,
  { column: 'createdAt' | 'dueDate' | 'updatedAt'; kind: ScalarKind; nullable: boolean }
> = {
  createdAt: { column: 'createdAt', kind: 'timestamp', nullable: false },
  dueDate: { column: 'dueDate', kind: 'date', nullable: true },
  updatedAt: { column: 'updatedAt', kind: 'timestamp', nullable: false },
};

function wantedList(c: FilterCondition): unknown[] {
  if (Array.isArray(c.value)) {
    return c.value;
  }
  return c.value === undefined ? [null] : [c.value];
}

function utcDayStart(v: unknown): Date {
  const day = String(v).slice(0, 10);
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new UnsupportedFilterError('Filter has an invalid date');
  }
  return d;
}

function nextDay(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
}

/** `eq`/`in`: the field's value is one of `wanted` (null = unset). */
function matchIn(
  column: string,
  nullable: boolean,
  values: Array<string | number>,
  hasNull: boolean,
): Prisma.IssueWhereInput {
  const ors: Prisma.IssueWhereInput[] = [];
  if (values.length > 0) {
    ors.push({ [column]: { in: values } });
  }
  if (hasNull && nullable) {
    ors.push({ [column]: null });
  }
  return ors.length === 0 ? NO_MATCH : { OR: ors };
}

/** `neq`/`nin`, written out so unset values behave as the in-memory engine does. */
function matchNotIn(
  column: string,
  nullable: boolean,
  values: Array<string | number>,
  hasNull: boolean,
): Prisma.IssueWhereInput {
  const notIn: Prisma.IssueWhereInput = { [column]: { notIn: values } };
  if (!nullable) {
    return values.length > 0 ? notIn : {};
  }
  if (hasNull) {
    // "is not <unset>": must be set, and not one of the others.
    return values.length > 0
      ? { AND: [{ [column]: { not: null } }, notIn] }
      : { [column]: { not: null } };
  }
  // An unset value is "not equal" to any concrete target.
  return values.length > 0 ? { OR: [{ [column]: null }, notIn] } : {};
}

function conditionWhere(c: FilterCondition, today: Date): Prisma.IssueWhereInput {
  const op = c.operator;
  if (c.field === 'custom') {
    throw new UnsupportedFilterError('Insights does not support custom-field filters');
  }

  if (c.field === 'label') {
    const ids = wantedList(c).filter((v): v is string => typeof v === 'string' && UUID.test(v));
    const hasNull = wantedList(c).some(v => v === null);
    const some: Prisma.IssueWhereInput = { labelAssignments: { some: { labelId: { in: ids } } } };
    const none: Prisma.IssueWhereInput = { labelAssignments: { none: {} } };
    const has = hasNull ? { OR: [some, none] } : some;
    switch (op) {
      case 'eq':
      case 'in':
        return has;
      case 'neq':
      case 'nin':
        return { NOT: has };
      case 'is_set':
        return { labelAssignments: { some: {} } };
      case 'is_not_set':
        return none;
      default:
        throw new UnsupportedFilterError(`Operator ${op} is not supported for labels`);
    }
  }

  const uuidSpec = UUID_FIELDS[c.field];
  if (uuidSpec) {
    const wanted = wantedList(c);
    const ids = wanted.filter((v): v is string => typeof v === 'string' && UUID.test(v));
    const hasNull = wanted.some(v => v === null);
    switch (op) {
      case 'eq':
      case 'in':
        return matchIn(uuidSpec.column, uuidSpec.nullable, ids, hasNull);
      case 'neq':
      case 'nin':
        return matchNotIn(uuidSpec.column, uuidSpec.nullable, ids, hasNull);
      case 'is_set':
        return uuidSpec.nullable ? { [uuidSpec.column]: { not: null } } : {};
      case 'is_not_set':
        return uuidSpec.nullable ? { [uuidSpec.column]: null } : NO_MATCH;
      default:
        throw new UnsupportedFilterError(`Operator ${op} is not supported for ${c.field}`);
    }
  }

  const numSpec = NUMBER_FIELDS[c.field];
  if (numSpec) {
    const wanted = wantedList(c);
    const nums = wanted
      .filter(v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))
      .map(Number)
      .filter(Number.isFinite);
    const hasNull = wanted.some(v => v === null);
    const single = Number(c.value);
    const cmp = (k: 'gt' | 'gte' | 'lt' | 'lte'): Prisma.IssueWhereInput => {
      if (!Number.isFinite(single) || c.value === null || c.value === undefined) {
        throw new UnsupportedFilterError(`Operator ${op} needs a number for ${c.field}`);
      }
      return { [numSpec.column]: { [k]: single } };
    };
    switch (op) {
      case 'eq':
      case 'in':
        return matchIn(numSpec.column, numSpec.nullable, nums, hasNull);
      case 'neq':
      case 'nin':
        return matchNotIn(numSpec.column, numSpec.nullable, nums, hasNull);
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return cmp(op);
      case 'is_set':
        return numSpec.nullable ? { [numSpec.column]: { not: null } } : {};
      case 'is_not_set':
        return numSpec.nullable ? { [numSpec.column]: null } : NO_MATCH;
      default:
        throw new UnsupportedFilterError(`Operator ${op} is not supported for ${c.field}`);
    }
  }

  const dateSpec = DATE_FIELDS[c.field];
  if (dateSpec) {
    const col = dateSpec.column;
    switch (op) {
      case 'before':
        return { [col]: { lt: utcDayStart(c.value) } };
      case 'after':
        return { [col]: { gte: nextDay(utcDayStart(c.value)) } };
      case 'gt':
        return { [col]: { gt: utcDayStart(c.value) } };
      case 'gte':
        return { [col]: { gte: utcDayStart(c.value) } };
      case 'lt':
        return { [col]: { lt: utcDayStart(c.value) } };
      case 'lte':
        return { [col]: { lte: utcDayStart(c.value) } };
      case 'eq':
      case 'in': {
        const days = wantedList(c).filter(v => v !== null && v !== undefined);
        const hasNull = wantedList(c).some(v => v === null);
        const ors: Prisma.IssueWhereInput[] = days.map(v => {
          const start = utcDayStart(v);
          return { [col]: { gte: start, lt: nextDay(start) } };
        });
        if (hasNull && dateSpec.nullable) {
          ors.push({ [col]: null });
        }
        return ors.length === 0 ? NO_MATCH : { OR: ors };
      }
      case 'neq':
      case 'nin': {
        const inner = conditionWhere({ ...c, operator: 'in' }, today);
        // SQL's NOT drops NULL rows; an unset date is "not equal" to a day.
        return dateSpec.nullable ? { OR: [{ [col]: null }, { NOT: inner }] } : { NOT: inner };
      }
      case 'is_set':
        return dateSpec.nullable ? { [col]: { not: null } } : {};
      case 'is_not_set':
        return dateSpec.nullable ? { [col]: null } : NO_MATCH;
      case 'overdue':
        if (c.field !== 'dueDate') {
          throw new UnsupportedFilterError('overdue only applies to the due date');
        }
        return {
          dueDate: { lt: today },
          state: { type: { notIn: ['completed', 'canceled'] } },
        };
      default:
        throw new UnsupportedFilterError(`Operator ${op} is not supported for ${c.field}`);
    }
  }

  throw new UnsupportedFilterError(`Unknown filter field: ${c.field}`);
}

/**
 * `where` fragment for `set`, or `null` for the empty filter. Throws
 * `UnsupportedFilterError` for what SQL cannot express here (custom fields) —
 * the caller reports that rather than silently widening the result.
 */
export function filterSetToWhere(
  set: FilterSet,
  now: Date = new Date(),
): Prisma.IssueWhereInput | null {
  if (set.conditions.length === 0) {
    return null;
  }
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const parts = set.conditions.map(c => conditionWhere(c, today));
  return set.composition === 'or' ? { OR: parts } : { AND: parts };
}
