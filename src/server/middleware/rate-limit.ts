import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

/**
 * Per-user rate limit configuration.
 * Window is a fixed 1-hour bucket (not sliding window).
 */
const WINDOW_SECONDS = 60 * 60; // 1 hour
const REQUEST_LIMIT = 5_000;
const COMPLEXITY_LIMIT = 250_000;
const MAX_SINGLE_COMPLEXITY = 10_000;

/**
 * Calculate GraphQL operation complexity.
 *
 * Rules (matches API_DESIGN.md §12):
 * - Each scalar field: 0.1 points
 * - Each object: 1 point
 * - Connections: multiply child complexity by `first` argument (default 50)
 *
 * This is a lightweight regex-based estimate rather than a full AST parse.
 * A production implementation would use graphql-query-complexity, but this
 * approximation is sufficient for the Alpha milestone.
 */
export function estimateComplexity(body: {
  query?: string;
  variables?: Record<string, unknown>;
}): number {
  const query = body.query ?? '';
  // Count field selections as a proxy for complexity
  const fieldMatches = query.match(/\w+\s*[{(]/g) ?? [];
  const firstArg = (body.variables?.first as number | undefined) ?? 50;
  // Rough formula: fields * first-arg multiplier, capped at max
  const estimate = Math.min(
    fieldMatches.length * firstArg * 0.1,
    MAX_SINGLE_COMPLEXITY,
  );
  return Math.max(1, Math.round(estimate));
}

/**
 * Check and increment rate limit counters for a given user.
 * Fails open (returns exceeded=false) if Redis is unavailable.
 */
export async function checkRateLimit(
  userId: string,
  complexity: number,
): Promise<{ headers: Record<string, string>; exceeded: boolean }> {
  const bucketKey = `rl:${userId}:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`;
  const reqKey = `${bucketKey}:req`;
  const cmpKey = `${bucketKey}:cmp`;

  let reqCount: number;
  let cmpCount: number;

  try {
    const result = await redis
      .multi()
      .incr(reqKey)
      .incrby(cmpKey, complexity)
      .expire(reqKey, WINDOW_SECONDS)
      .expire(cmpKey, WINDOW_SECONDS)
      .exec();

    if (!result) {
      throw new Error('Redis pipeline returned null');
    }

    const [reqRes, cmpRes] = result as Array<[Error | null, number]>;
    if (reqRes[0] || cmpRes[0]) {
      throw reqRes[0] ?? cmpRes[0];
    }

    reqCount = reqRes[1];
    cmpCount = cmpRes[1];
  } catch (err) {
    logger.error({ err }, 'Rate limit check failed — allowing request');
    return { exceeded: false, headers: {} };
  }

  const resetAt =
    Math.floor(Date.now() / 1000 / WINDOW_SECONDS + 1) * WINDOW_SECONDS;
  const requestsRemaining = Math.max(0, REQUEST_LIMIT - reqCount);
  const complexityRemaining = Math.max(0, COMPLEXITY_LIMIT - cmpCount);
  const exceeded = reqCount > REQUEST_LIMIT || cmpCount > COMPLEXITY_LIMIT;

  const headers: Record<string, string> = {
    'X-Complexity': String(complexity),
    'X-RateLimit-Complexity-Limit': String(COMPLEXITY_LIMIT),
    'X-RateLimit-Complexity-Remaining': String(complexityRemaining),
    'X-RateLimit-Requests-Limit': String(REQUEST_LIMIT),
    'X-RateLimit-Requests-Remaining': String(requestsRemaining),
    'X-RateLimit-Requests-Reset': String(resetAt),
  };

  return { exceeded, headers };
}

/**
 * Build a RATELIMITED GraphQL error response (HTTP 400 per spec).
 */
export function buildRateLimitedResponse(
  headers: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      errors: [
        {
          extensions: { code: 'RATELIMITED' },
          message: 'Rate limit exceeded. Try again later.',
        },
      ],
    }),
    {
      headers: { 'Content-Type': 'application/json', ...headers },
      status: 400,
    },
  );
}

/**
 * Clone a Response and add rate limit headers to the clone.
 * Returns the new Response — the original is not mutated (Response headers
 * are immutable in the Web API).
 */
export function withRateLimitHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  const clone = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) {
    clone.headers.set(key, value);
  }
  return clone;
}
