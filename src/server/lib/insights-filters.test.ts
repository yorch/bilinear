import { describe, expect, it } from 'vitest';
import type { FilterCondition } from '../../lib/filter-engine';
import { filterSetToWhere, UnsupportedFilterError } from './insights-filters';

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-06-15T12:00:00Z');
const where = (c: FilterCondition, composition: 'and' | 'or' = 'and') =>
  filterSetToWhere({ composition, conditions: [c] }, NOW);

describe('filterSetToWhere', () => {
  it('is null for the empty filter and honours and/or composition', () => {
    expect(filterSetToWhere({ composition: 'and', conditions: [] })).toBeNull();
    const c: FilterCondition = { field: 'priority', operator: 'eq', value: 1 };
    expect(where(c)).toHaveProperty('AND');
    expect(where(c, 'or')).toHaveProperty('OR');
  });

  it('in / eq on a nullable id matches unset only for an explicit null target', () => {
    expect(where({ field: 'assignee', operator: 'in', value: [U, null] as never })).toEqual({
      AND: [{ OR: [{ assigneeId: { in: [U] } }, { assigneeId: null }] }],
    });
    expect(where({ field: 'assignee', operator: 'eq', value: U })).toEqual({
      AND: [{ OR: [{ assigneeId: { in: [U] } }] }],
    });
  });

  it('neq keeps unset rows (SQL NOT would drop them)', () => {
    expect(where({ field: 'assignee', operator: 'neq', value: U })).toEqual({
      AND: [{ OR: [{ assigneeId: null }, { assigneeId: { notIn: [U] } }] }],
    });
    expect(where({ field: 'assignee', operator: 'neq', value: null })).toEqual({
      AND: [{ assigneeId: { not: null } }],
    });
  });

  it('drops non-uuid targets instead of letting the database reject the query', () => {
    expect(where({ field: 'status', operator: 'in', value: ['not-a-uuid'] })).toEqual({
      AND: [{ id: { in: [] } }],
    });
  });

  it('labels use set semantics', () => {
    expect(where({ field: 'label', operator: 'in', value: [U, V] })).toEqual({
      AND: [{ labelAssignments: { some: { labelId: { in: [U, V] } } } }],
    });
    expect(where({ field: 'label', operator: 'is_not_set' })).toEqual({
      AND: [{ labelAssignments: { none: {} } }],
    });
  });

  it('numeric comparison and null handling', () => {
    expect(where({ field: 'estimate', operator: 'gte', value: 3 })).toEqual({
      AND: [{ estimate: { gte: 3 } }],
    });
    expect(() => where({ field: 'estimate', operator: 'gt', value: 'abc' })).toThrow(
      UnsupportedFilterError,
    );
  });

  it('date operators compare UTC days', () => {
    expect(where({ field: 'dueDate', operator: 'before', value: '2026-06-10' })).toEqual({
      AND: [{ dueDate: { lt: new Date('2026-06-10T00:00:00.000Z') } }],
    });
    expect(where({ field: 'createdAt', operator: 'after', value: '2026-06-10T15:00:00Z' })).toEqual(
      {
        AND: [{ createdAt: { gte: new Date('2026-06-11T00:00:00.000Z') } }],
      },
    );
  });

  it('overdue excludes closed states', () => {
    expect(where({ field: 'dueDate', operator: 'overdue' })).toEqual({
      AND: [
        {
          dueDate: { lt: new Date('2026-06-15T00:00:00.000Z') },
          state: { type: { notIn: ['completed', 'canceled'] } },
        },
      ],
    });
  });

  it('refuses custom fields and invalid dates rather than widening', () => {
    expect(() => where({ field: 'custom', operator: 'eq', value: 'x' })).toThrow(
      UnsupportedFilterError,
    );
    expect(() => where({ field: 'dueDate', operator: 'before', value: 'zzz' })).toThrow(
      UnsupportedFilterError,
    );
  });
});
