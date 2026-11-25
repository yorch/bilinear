import { describe, expect, it } from 'vitest';
import {
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_VALUES,
  sanitizeStoredFilterSet,
  validateFilterSet,
} from './filter-validate';

describe('validateFilterSet', () => {
  it.each([null, undefined, {}, { conditions: [] }])('treats %j as the empty filter', v => {
    expect(validateFilterSet(v)).toEqual({
      ok: true,
      set: { composition: 'and', conditions: [] },
    });
  });

  it('keeps a well-formed set and normalises composition', () => {
    const r = validateFilterSet({
      composition: 'or',
      conditions: [{ extra: 'dropped', field: 'status', operator: 'in', value: ['a', 'b'] }],
    });
    expect(r).toEqual({
      ok: true,
      set: {
        composition: 'or',
        conditions: [{ field: 'status', operator: 'in', value: ['a', 'b'] }],
      },
    });
  });

  it.each([
    ['null condition', { conditions: [null] }],
    ['array condition', { conditions: [[]] }],
    ['unknown field', { conditions: [{ field: 'x', operator: 'eq' }] }],
    ['unknown operator', { conditions: [{ field: 'status', operator: 'regex' }] }],
    ['object value', { conditions: [{ field: 'status', operator: 'eq', value: { a: 1 } }] }],
    ['nested array', { conditions: [{ field: 'status', operator: 'in', value: [['a']] }] }],
    ['NaN', { conditions: [{ field: 'priority', operator: 'eq', value: Number.NaN }] }],
    ['long string', { conditions: [{ field: 'status', operator: 'eq', value: 'x'.repeat(300) }] }],
    ['bad composition', { composition: 'xor', conditions: [] }],
    ['non-array conditions', { conditions: 'x' }],
    ['array root', []],
    ['string root', 'x'],
  ])('rejects %s', (_n, v) => {
    expect(validateFilterSet(v).ok).toBe(false);
  });

  it('caps the number of conditions and values', () => {
    const cond = { field: 'priority', operator: 'eq', value: 1 };
    expect(validateFilterSet({ conditions: Array(MAX_FILTER_CONDITIONS).fill(cond) }).ok).toBe(
      true,
    );
    expect(validateFilterSet({ conditions: Array(MAX_FILTER_CONDITIONS + 1).fill(cond) }).ok).toBe(
      false,
    );
    const many = (n: number) => ({
      conditions: [{ field: 'status', operator: 'nin', value: Array(n).fill('a') }],
    });
    expect(validateFilterSet(many(MAX_FILTER_VALUES)).ok).toBe(true);
    expect(validateFilterSet(many(MAX_FILTER_VALUES + 1)).ok).toBe(false);
  });
});

describe('unknown top-level keys and stored-view sanitising', () => {
  it('rejects a filter set carrying a foreign top-level key', () => {
    const r = validateFilterSet({ s2: 'x' });
    expect(r.ok).toBe(false);
    expect(validateFilterSet({ conditions: [], extra: 1 }).ok).toBe(false);
  });

  it('still accepts the empty column default and a well-formed set', () => {
    expect(validateFilterSet({}).ok).toBe(true);
    expect(
      validateFilterSet({ composition: 'or', conditions: [{ field: 'priority', operator: 'eq' }] })
        .ok,
    ).toBe(true);
  });

  it('sanitizeStoredFilterSet keeps sound conditions, drops and counts the rest', () => {
    const r = sanitizeStoredFilterSet({
      conditions: [
        { field: 'priority', operator: 'eq', value: 1 },
        null,
        { field: 'nope', operator: 'eq' },
      ],
      s2: 'x',
    });
    expect(r.dropped).toBe(2);
    expect(r.set?.conditions).toEqual([{ field: 'priority', operator: 'eq', value: 1 }]);
  });

  it('sanitizeStoredFilterSet refuses (null set) a stored value that is not an object', () => {
    expect(sanitizeStoredFilterSet('garbage').set).toBeNull();
    expect(sanitizeStoredFilterSet({}).dropped).toBe(0);
  });
});
