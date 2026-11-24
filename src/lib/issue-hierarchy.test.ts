import { describe, expect, it } from 'vitest';
import { canBeParent, collectDescendantIds } from './issue-hierarchy';

const rows = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: null },
];

describe('issue hierarchy', () => {
  it('collects every descendant, not just direct children', () => {
    expect([...collectDescendantIds(rows, 'a')].sort()).toEqual(['b', 'c']);
  });

  it('returns an empty set for a leaf', () => {
    expect(collectDescendantIds(rows, 'c').size).toBe(0);
  });

  it('refuses self and descendants as a parent', () => {
    expect(canBeParent(rows, 'a', 'a')).toBe(false);
    expect(canBeParent(rows, 'a', 'c')).toBe(false);
  });

  it('allows an ancestor, a sibling tree and a fresh root', () => {
    expect(canBeParent(rows, 'c', 'a')).toBe(true);
    expect(canBeParent(rows, 'c', 'd')).toBe(true);
  });

  it('terminates on a pre-existing loop', () => {
    const loop = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ];
    expect([...collectDescendantIds(loop, 'x')].sort()).toEqual(['x', 'y']);
  });
});
