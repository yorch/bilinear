/**
 * Lightweight fuzzy search for local MobX store data.
 *
 * Scores a `target` string against a `query` string using a simple
 * subsequence-match algorithm with scoring heuristics:
 *   - Consecutive matches score higher than scattered ones
 *   - Prefix matches score highest
 *   - All query characters must appear in the target (in order) to score > 0
 *
 * Returns a number in [0, 1] where 1 is a perfect prefix match and 0 means no
 * match. A score of exactly 0 means the candidate should be excluded.
 */
export function fuzzyScore(target: string, query: string): number {
  if (!query) {
    return 1;
  }

  const t = target.toLowerCase();
  const q = query.toLowerCase();

  // Exact match is highest
  if (t === q) {
    return 1;
  }
  // Prefix match is second highest
  if (t.startsWith(q)) {
    return 0.9 + 0.1 * (q.length / t.length);
  }

  // Subsequence matching with run-length scoring
  let ti = 0;
  let qi = 0;
  let score = 0;
  let consecutiveRun = 0;

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      consecutiveRun++;
      score += consecutiveRun; // longer runs score more per character
      qi++;
    } else {
      consecutiveRun = 0;
    }
    ti++;
  }

  // All query chars must appear in order
  if (qi < q.length) {
    return 0;
  }

  // Normalize: max possible score is sum(1..q.length) = q.length*(q.length+1)/2
  const maxScore = (q.length * (q.length + 1)) / 2;
  return (score / maxScore) * 0.8; // cap below prefix match score
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

/**
 * Filter and rank an array of items by fuzzy-matching a query against a
 * string extracted from each item.
 *
 * @param items   Array of items to search
 * @param query   Search query
 * @param getText Function that extracts the string to match against
 * @returns Items with score > 0, sorted by descending score
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): FuzzyMatch<T>[] {
  if (!query.trim()) {
    return items.map(item => ({ item, score: 1 }));
  }

  return items
    .map(item => ({ item, score: fuzzyScore(getText(item), query) }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score);
}
