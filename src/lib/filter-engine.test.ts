import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  applySorting,
  coerceSortFields,
  createEmptyFilterSet,
  type FilterableIssue,
  type FilterCondition,
  type FilterSet,
  type SortField,
} from './filter-engine';

function issue(overrides: Partial<FilterableIssue> & { id: string }): FilterableIssue {
  return {
    priority: 0,
    stateId: 'state-todo',
    ...overrides,
  };
}

const ISSUES: FilterableIssue[] = [
  issue({
    assigneeId: 'user-a',
    createdAt: '2026-01-01',
    dueDate: '2026-06-01',
    estimate: 2,
    id: '1',
    labelIds: ['bug'],
    priority: 1,
    stateId: 'state-todo',
    updatedAt: '2026-02-01',
  }),
  issue({
    assigneeId: 'user-b',
    createdAt: '2026-01-02',
    dueDate: null,
    estimate: 5,
    id: '2',
    labelIds: ['feature', 'bug'],
    priority: 3,
    stateId: 'state-done',
    updatedAt: '2026-03-01',
  }),
  issue({
    assigneeId: null,
    createdAt: '2026-01-03',
    dueDate: '2026-05-01',
    estimate: null,
    id: '3',
    labelIds: [],
    priority: 2,
    stateId: 'state-todo',
    updatedAt: '2026-01-15',
  }),
];

function ids(list: FilterableIssue[]): string[] {
  return list.map(i => i.id);
}

describe('applyFilters', () => {
  it('returns all issues when there are no conditions', () => {
    const result = applyFilters(ISSUES, createEmptyFilterSet());
    expect(result).toBe(ISSUES); // same reference — no copy when empty
  });

  describe('eq / neq', () => {
    it('eq matches on a scalar field', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'status', operator: 'eq', value: 'state-todo' }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '3']);
    });

    it('neq excludes matches', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'status', operator: 'neq', value: 'state-todo' }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['2']);
    });

    it('eq on priority (numeric field)', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'priority', operator: 'eq', value: 2 }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['3']);
    });
  });

  describe('in / nin', () => {
    it('in matches any of the provided scalar values', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'assignee', operator: 'in', value: ['user-a', 'user-b'] }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '2']);
    });

    it('in on priority coerces values to strings for comparison', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'priority', operator: 'in', value: ['1', '3'] }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '2']);
    });

    it('in on label matches issues holding any of the labels', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'label', operator: 'in', value: ['bug'] }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '2']);
    });

    it('nin on label excludes issues holding any of the labels', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'label', operator: 'nin', value: ['bug'] }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['3']);
    });

    it('in / nin accept a scalar value as a one-item list', () => {
      const inSet: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'assignee', operator: 'in', value: 'user-a' }],
      };
      expect(ids(applyFilters(ISSUES, inSet))).toEqual(['1']);
      const ninSet: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'assignee', operator: 'nin', value: 'user-a' }],
      };
      expect(ids(applyFilters(ISSUES, ninSet))).toEqual(['2', '3']);
    });
  });

  // Operator x field-type matrix, built from the value shapes the filter form
  // emits (arrays for in/nin, a scalar for eq/neq).
  describe('operator x field matrix', () => {
    const run = (
      field: FilterCondition['field'],
      operator: FilterCondition['operator'],
      value: FilterCondition['value'],
    ) =>
      ids(applyFilters(ISSUES, { composition: 'and', conditions: [{ field, operator, value }] }));

    it('status: any of / none of', () => {
      expect(run('status', 'in', ['state-todo'])).toEqual(['1', '3']);
      expect(run('status', 'in', ['state-todo', 'state-done'])).toEqual(['1', '2', '3']);
      expect(run('status', 'nin', ['state-todo'])).toEqual(['2']);
      expect(run('status', 'nin', ['state-todo', 'state-done'])).toEqual([]);
    });

    it('assignee: unassigned issues are in "none of" and never in "any of"', () => {
      expect(run('assignee', 'in', ['user-a'])).toEqual(['1']);
      expect(run('assignee', 'nin', ['user-a'])).toEqual(['2', '3']);
      expect(run('assignee', 'neq', 'user-a')).toEqual(['2', '3']);
    });

    it('priority: numeric field against string-typed form values', () => {
      expect(run('priority', 'eq', '2')).toEqual(['3']);
      expect(run('priority', 'in', ['1', '2'])).toEqual(['1', '3']);
      expect(run('priority', 'nin', ['1', '2'])).toEqual(['2']);
    });

    it('label: is / is not use set semantics for multi-label issues', () => {
      expect(run('label', 'eq', 'bug')).toEqual(['1', '2']);
      expect(run('label', 'neq', 'bug')).toEqual(['3']);
      expect(run('label', 'eq', 'feature')).toEqual(['2']);
      expect(run('label', 'neq', 'feature')).toEqual(['1', '3']);
    });

    it('label: any of / none of', () => {
      expect(run('label', 'in', ['bug', 'feature'])).toEqual(['1', '2']);
      expect(run('label', 'in', ['feature'])).toEqual(['2']);
      expect(run('label', 'nin', ['feature'])).toEqual(['1', '3']);
      expect(run('label', 'nin', ['bug', 'feature'])).toEqual(['3']);
    });

    it('label: "is null" matches unlabelled issues and "is not null" matches labelled ones', () => {
      expect(run('label', 'eq', null as never)).toEqual(['3']);
      expect(run('label', 'neq', null as never)).toEqual(['1', '2']);
      expect(run('label', 'in', ['bug', null] as never)).toEqual(['1', '2', '3']);
    });

    it('label: is_set / is_not_set', () => {
      expect(run('label', 'is_set', undefined)).toEqual(['1', '2']);
      expect(run('label', 'is_not_set', undefined)).toEqual(['3']);
    });

    it('a custom multi-select value uses set semantics for is / is not', () => {
      const resolver = (issueId: string) => (issueId === '1' ? ['y', 'z'] : ['z']);
      const withResolver = (
        operator: FilterCondition['operator'],
        value: FilterCondition['value'],
      ) =>
        ids(
          applyFilters(
            ISSUES,
            {
              composition: 'and',
              conditions: [{ customFieldId: 'tags', field: 'custom', operator, value }],
            },
            resolver,
          ),
        );
      expect(withResolver('eq', 'y')).toEqual(['1']);
      expect(withResolver('neq', 'y')).toEqual(['2', '3']);
      expect(withResolver('nin', ['y'])).toEqual(['2', '3']);
    });

    it('is_set / is_not_set on scalar fields', () => {
      expect(run('assignee', 'is_not_set', undefined)).toEqual(['3']);
      expect(run('dueDate', 'is_set', undefined)).toEqual(['1', '3']);
      expect(run('estimate', 'is_not_set', undefined)).toEqual(['3']);
    });
  });

  describe('comparison operators', () => {
    // priority is always numeric, so these exercise the numeric comparison path.
    it('gt / gte / lt / lte compare numerically', () => {
      const gt: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'priority', operator: 'gt', value: 2 }],
      };
      expect(ids(applyFilters(ISSUES, gt))).toEqual(['2']);

      const gte: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'priority', operator: 'gte', value: 2 }],
      };
      expect(ids(applyFilters(ISSUES, gte))).toEqual(['2', '3']);

      const lt: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'priority', operator: 'lt', value: 2 }],
      };
      expect(ids(applyFilters(ISSUES, lt))).toEqual(['1']);

      const lte: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'priority', operator: 'lte', value: 2 }],
      };
      expect(ids(applyFilters(ISSUES, lte))).toEqual(['1', '3']);
    });

    // Documents existing behavior: when a field value is null the engine falls
    // back to lexical string comparison ('null' > '2' is true), so null
    // estimates are NOT excluded from a numeric `gt`. Pinned to catch
    // regressions if this is ever tightened.
    it('falls back to string comparison when a value is null', () => {
      const onlyNull = [issue({ estimate: null, id: 'n' })];
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'estimate', operator: 'gt', value: 2 }],
      };
      expect(ids(applyFilters(onlyNull, set))).toEqual(['n']);
    });
  });

  describe('is_set / is_not_set', () => {
    it('is_set keeps issues with a non-null value', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'assignee', operator: 'is_set' }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '2']);
    });

    it('is_not_set keeps issues with a null/undefined value', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ field: 'dueDate', operator: 'is_not_set' }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['2']);
    });
  });

  describe('composition', () => {
    it('and requires every condition to match', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [
          { field: 'status', operator: 'eq', value: 'state-todo' },
          { field: 'priority', operator: 'eq', value: 1 },
        ],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1']);
    });

    it('or requires at least one condition to match', () => {
      const set: FilterSet = {
        composition: 'or',
        conditions: [
          { field: 'priority', operator: 'eq', value: 1 },
          { field: 'priority', operator: 'eq', value: 3 },
        ],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '2']);
    });
  });

  describe('custom fields', () => {
    it('uses the resolver to read custom-field values', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ customFieldId: 'sev', field: 'custom', operator: 'eq', value: 'high' }],
      };
      const resolver = (issueId: string) => (issueId === '2' ? 'high' : 'low');
      expect(ids(applyFilters(ISSUES, set, resolver))).toEqual(['2']);
    });

    it('in on a multi-select custom value matches on overlap', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ customFieldId: 'tags', field: 'custom', operator: 'in', value: ['x', 'y'] }],
      };
      const resolver = (issueId: string) => (issueId === '1' ? ['y', 'z'] : ['z']);
      expect(ids(applyFilters(ISSUES, set, resolver))).toEqual(['1']);
    });

    it('resolves to null when no resolver is supplied', () => {
      const set: FilterSet = {
        composition: 'and',
        conditions: [{ customFieldId: 'sev', field: 'custom', operator: 'is_not_set' }],
      };
      expect(ids(applyFilters(ISSUES, set))).toEqual(['1', '2', '3']);
    });
  });
});

describe('applySorting', () => {
  it('returns the input untouched when no sort fields', () => {
    const result = applySorting(ISSUES, []);
    expect(result).toBe(ISSUES);
  });

  it('does not mutate the input array', () => {
    const sort: SortField[] = [{ direction: 'asc', field: 'priority' }];
    const before = ids(ISSUES);
    applySorting(ISSUES, sort);
    expect(ids(ISSUES)).toEqual(before);
  });

  it('sorts by priority ascending and descending', () => {
    const asc = applySorting(ISSUES, [{ direction: 'asc', field: 'priority' }]);
    expect(ids(asc)).toEqual(['1', '3', '2']);

    const desc = applySorting(ISSUES, [{ direction: 'desc', field: 'priority' }]);
    expect(ids(desc)).toEqual(['2', '3', '1']);
  });

  it('priority sort keeps "No priority" last in both directions (asc = urgent-first, desc = low-first)', () => {
    const withNone = [...ISSUES, issue({ id: 'none', priority: 0 })];
    expect(ids(applySorting(withNone, [{ direction: 'asc', field: 'priority' }]))).toEqual([
      '1',
      '3',
      '2',
      'none',
    ]);
    expect(ids(applySorting(withNone, [{ direction: 'desc', field: 'priority' }]))).toEqual([
      '2',
      '3',
      '1',
      'none',
    ]);
  });

  it('sorts by status using the position map', () => {
    const positions = new Map([
      ['state-done', 0],
      ['state-todo', 1],
    ]);
    const sorted = applySorting(ISSUES, [{ direction: 'asc', field: 'status' }], positions);
    expect(ids(sorted)).toEqual(['2', '1', '3']);
  });

  it('sorts nulls last for dueDate ascending', () => {
    const sorted = applySorting(ISSUES, [{ direction: 'asc', field: 'dueDate' }]);
    // '3' (2026-05-01) < '1' (2026-06-01) < '2' (null → sentinel last)
    expect(ids(sorted)).toEqual(['3', '1', '2']);
  });

  it('falls back to the next sort field when the first ties', () => {
    const sorted = applySorting(ISSUES, [
      { direction: 'asc', field: 'status' },
      { direction: 'desc', field: 'priority' },
    ]);
    // state-done first ('2'), then the two state-todo issues by priority desc: '3'(2) before '1'(1)
    expect(ids(sorted)).toEqual(['2', '3', '1']);
  });

  it('sorts by created and updated timestamps', () => {
    const byCreated = applySorting(ISSUES, [{ direction: 'desc', field: 'created' }]);
    expect(ids(byCreated)).toEqual(['3', '2', '1']);

    const byUpdated = applySorting(ISSUES, [{ direction: 'asc', field: 'updated' }]);
    expect(ids(byUpdated)).toEqual(['3', '1', '2']);
  });

  it('sorts manually by sortOrder', () => {
    const list = [
      issue({ id: 'a', sortOrder: 30 }),
      issue({ id: 'b', sortOrder: 10 }),
      issue({ id: 'c', sortOrder: 20 }),
    ];
    expect(ids(applySorting(list, [{ direction: 'asc', field: 'manual' }]))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
});

describe('applySorting priority', () => {
  it('sorts "No priority" after Low when ascending (urgent first)', () => {
    const list = [
      issue({ id: 'none', priority: 0 }),
      issue({ id: 'low', priority: 4 }),
      issue({ id: 'urgent', priority: 1 }),
    ];
    expect(ids(applySorting(list, [{ direction: 'asc', field: 'priority' }]))).toEqual([
      'urgent',
      'low',
      'none',
    ]);
  });
});

describe('createEmptyFilterSet', () => {
  it('returns an and-composed set with no conditions', () => {
    expect(createEmptyFilterSet()).toEqual({ composition: 'and', conditions: [] });
  });
});

describe('coerceSortFields', () => {
  it('passes a well-formed stored sort through', () => {
    const sort: SortField[] = [
      { direction: 'desc', field: 'priority' },
      { direction: 'asc', field: 'dueDate' },
    ];
    expect(coerceSortFields(sort)).toEqual(sort);
  });

  it('returns no sort for a non-array (a view saved before sort existed)', () => {
    expect(coerceSortFields(undefined)).toEqual([]);
    expect(coerceSortFields(null)).toEqual([]);
    expect(coerceSortFields({})).toEqual([]);
  });

  it('drops entries with an unknown field or direction instead of passing them on', () => {
    expect(
      coerceSortFields([
        { direction: 'asc', field: 'priority' },
        { direction: 'sideways', field: 'priority' },
        { direction: 'asc', field: 'colour' },
        'priority',
        null,
      ]),
    ).toEqual([{ direction: 'asc', field: 'priority' }]);
  });

  it('feeds applySorting so a stored view sort actually orders the list', () => {
    const sorted = applySorting(
      ISSUES,
      coerceSortFields([{ direction: 'desc', field: 'priority' }]),
    );
    const priorities = sorted.map(i => i.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });
});
