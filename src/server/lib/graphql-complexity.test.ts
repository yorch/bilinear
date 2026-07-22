import { describe, expect, it } from 'vitest';
import {
  listArgumentEstimator,
  MAX_LIST_COMPLEXITY_MULTIPLIER,
  MAX_QUERY_COMPLEXITY,
} from './graphql-complexity';

const estimate = listArgumentEstimator();

// The estimator is called by graphql-query-complexity with { args, childComplexity }.
function cost(childComplexity: number, args?: Record<string, unknown>): number {
  // biome-ignore lint/suspicious/noExplicitAny: exercising the estimator directly with a minimal arg shape
  return estimate({ args, childComplexity } as any) as number;
}

describe('listArgumentEstimator', () => {
  it('is byte-identical to simpleEstimator (1 + childComplexity) with no list arg', () => {
    expect(cost(36)).toBe(37);
    expect(cost(36, {})).toBe(37);
    expect(cost(36, { id: 'x' })).toBe(37);
  });

  it('multiplies child complexity by first/limit/last', () => {
    expect(cost(36, { first: 50 })).toBe(1 + 50 * 36);
    expect(cost(36, { limit: 10 })).toBe(1 + 10 * 36);
    expect(cost(36, { last: 20 })).toBe(1 + 20 * 36);
  });

  it('caps the multiplier at MAX_LIST_COMPLEXITY_MULTIPLIER', () => {
    expect(cost(10, { first: 999_999 })).toBe(1 + MAX_LIST_COMPLEXITY_MULTIPLIER * 10);
  });

  it('treats first <= 1 or non-numeric as multiplier 1', () => {
    expect(cost(36, { first: 1 })).toBe(37);
    expect(cost(36, { first: 0 })).toBe(37);
    expect(cost(36, { first: 'abc' })).toBe(37);
    expect(cost(36, { first: Number.NaN })).toBe(37);
  });
});

// Regression guard: MAX_QUERY_COMPLEXITY must stay calibrated to the estimator.
// The bug this replaces: a flat 1000 cap left over from before the
// multiplicative estimator rejected ordinary `issues(first: 50)` queries.
describe('MAX_QUERY_COMPLEXITY calibration', () => {
  // A rich node (all of Issue's scalars plus a few small nested objects).
  const RICH_NODE_CHILD_COMPLEXITY = 50;

  it('admits a full single-level page at the server ceiling', () => {
    const fullPage = cost(RICH_NODE_CHILD_COMPLEXITY, { first: MAX_LIST_COMPLEXITY_MULTIPLIER });
    expect(fullPage).toBeLessThan(MAX_QUERY_COMPLEXITY);
  });

  it('admits an ordinary small page (the query the old flat cap rejected)', () => {
    // issues(first: 50) { ...~36 fields } — ~1801, over the old 1000 cap.
    expect(cost(36, { first: 50 })).toBeLessThan(MAX_QUERY_COMPLEXITY);
  });

  it('rejects an abusive two-level list explosion', () => {
    // issues(first: 200) { ... team { issues(first: 200) { ...fields } } }
    const innerList = cost(RICH_NODE_CHILD_COMPLEXITY, { first: MAX_LIST_COMPLEXITY_MULTIPLIER });
    const nodeWithNestedList = RICH_NODE_CHILD_COMPLEXITY + innerList;
    const outer = cost(nodeWithNestedList, { first: MAX_LIST_COMPLEXITY_MULTIPLIER });
    expect(outer).toBeGreaterThan(MAX_QUERY_COMPLEXITY);
  });
});
