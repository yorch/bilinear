import { afterEach, describe, expect, it } from 'vitest';
import { drawnIdsOf, setVisualOrder, stepVisualOrder } from './visual-order';

describe('stepVisualOrder', () => {
  afterEach(() => setVisualOrder(null));

  it('walks the drawn order, not the array order', () => {
    setVisualOrder(['A', 'C', 'B', 'D']);
    const arr = ['A', 'B', 'C', 'D'];
    expect(stepVisualOrder('A', 1, arr)).toBe('C');
    expect(stepVisualOrder('C', 1, arr)).toBe('B');
    expect(stepVisualOrder('B', -1, arr)).toBe('C');
  });

  it('clamps at both ends and starts from the top with no cursor', () => {
    setVisualOrder(['A', 'B']);
    expect(stepVisualOrder('B', 1, ['A', 'B'])).toBe('B');
    expect(stepVisualOrder('A', -1, ['A', 'B'])).toBe('A');
    expect(stepVisualOrder(null, 1, ['A', 'B'])).toBe('A');
  });

  it('falls back to the array when no list published an order, and drops stale ids', () => {
    expect(stepVisualOrder('A', 1, ['A', 'B'])).toBe('B');
    setVisualOrder(['X', 'A', 'B']);
    expect(stepVisualOrder('A', -1, ['A', 'B'])).toBe('A');
  });
});

describe('stepVisualOrder with every group collapsed', () => {
  afterEach(() => setVisualOrder(null));

  it('treats a published empty order as "nothing is drawn", not as unpublished', () => {
    setVisualOrder([]);
    expect(stepVisualOrder(null, 1, ['A', 'B'])).toBeNull();
    expect(stepVisualOrder('A', 1, ['A', 'B'])).toBeNull();
  });
});

describe('drawnIdsOf', () => {
  const groups = [
    { issues: [{ id: 'A' }, { id: 'B' }], key: 'urgent' },
    { issues: [{ id: 'C' }], key: 'none' },
  ];
  it('skips rows of collapsed groups', () => {
    expect(drawnIdsOf(groups, new Set(['urgent']))).toEqual(['C']);
    expect(drawnIdsOf(groups, new Set())).toEqual(['A', 'B', 'C']);
  });
  it('ignores collapse when the list has no headers', () => {
    expect(drawnIdsOf(groups, new Set(['urgent']), true)).toEqual(['A', 'B', 'C']);
  });
});
