import type { ComplexityEstimator } from 'graphql-query-complexity';
import { MAX_LIST_LIMIT } from './limits';

/**
 * GraphQL query-complexity limits + the list-aware estimator, extracted here
 * so the calibration between the cap and the estimator can be unit-tested (a
 * mismatch previously rejected ordinary paginated queries — see
 * graphql-complexity.test.ts).
 */

// Hard cap enforced by a GraphQL validation rule (see the /api/graphql route),
// rejecting a query before any resolver runs.
//
// Calibrated for the multiplicative `listArgumentEstimator` below (a list field
// costs `first * childComplexity`, not a flat 1). A single full page at the
// server's own MAX_LIST_LIMIT selecting a rich node (~50 units of child cost)
// is ~10k, so 25k leaves comfortable headroom for the app's real paginated
// queries while still rejecting a genuinely abusive multi-level list explosion
// (e.g. a nested `issues { … issues }`, which is ~200*(50+200*50) ≈ 2M). If a
// legitimate query is ever rejected, raise this rather than weakening the
// estimator. The pre-multiplier flat cap was 1000, which this estimator would
// have made reject ordinary `first: 50` queries.
export const MAX_QUERY_COMPLEXITY = 25_000;

// Cap applied to any `first`/`limit`/`last` value when used as a multiplier, so
// a client-claimed absurd page size (`first: 999999`) can't fan out real cost
// unbounded or inflate the computed complexity into overflow territory.
// Deliberately reuses MAX_LIST_LIMIT — the same ceiling every list resolver
// clamps to at runtime (clampLimit) — so a caller is never penalized beyond
// what the server would actually let them page through. Tune alongside
// MAX_LIST_LIMIT if that ceiling ever changes.
export const MAX_LIST_COMPLEXITY_MULTIPLIER = MAX_LIST_LIMIT;

/**
 * List-aware complexity estimator. The schema has no per-field `complexity`
 * extensions, and `simpleEstimator` treats every field as cost 1 regardless of
 * how many rows it can return — so `issues(first: 10000) { assignee { … } }`
 * would cost the same as `issues(first: 1) { … }` even though the former fans
 * its child selection out thousands of times. This multiplies a field's child
 * complexity by its `first`/`limit`/`last` argument (when present and numeric),
 * capped at MAX_LIST_COMPLEXITY_MULTIPLIER.
 *
 * Conservative: a field with no first/limit/last arg gets multiplier 1, i.e.
 * byte-identical to `simpleEstimator({ defaultComplexity: 1 })`. It's a
 * heuristic, not a precise cost model — it doesn't know actual DB fan-out and
 * only weights the single level graphql-query-complexity recurses through via
 * childComplexity.
 */
export function listArgumentEstimator(): ComplexityEstimator {
  return ({ args, childComplexity }) => {
    const rawArg = (args?.first ?? args?.limit ?? args?.last) as unknown;
    let multiplier = 1;
    if (typeof rawArg === 'number' && Number.isFinite(rawArg) && rawArg > 1) {
      multiplier = Math.min(Math.floor(rawArg), MAX_LIST_COMPLEXITY_MULTIPLIER);
    }
    // Matches simpleEstimator's own `defaultComplexity + childComplexity` shape
    // (defaultComplexity 1) when multiplier is 1, so a field with no list arg
    // costs exactly what it did before list-awareness was added.
    return 1 + multiplier * childComplexity;
  };
}
