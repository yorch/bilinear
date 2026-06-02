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
  const estimate = Math.min(fieldMatches.length * firstArg * 0.1, MAX_SINGLE_COMPLEXITY);
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

  const resetAt = Math.floor(Date.now() / 1000 / WINDOW_SECONDS + 1) * WINDOW_SECONDS;
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
export function buildRateLimitedResponse(headers: Record<string, string>): Response {
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

/**
 * Simple fixed-window INCR-based limiter.
 *
 * Returns `{ exceeded }` — `true` when the counter exceeded `limit` within
 * the current window. Fails open on Redis errors (same policy as the
 * authenticated GraphQL limiter above) so a Redis outage doesn't block login.
 *
 * The bucket key is namespaced by the caller (e.g. `auth:login:email:foo@…`).
 */
export async function checkFixedWindow(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  failClosed = false,
): Promise<{ exceeded: boolean; count: number }> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${bucketKey}:${bucket}`;
  try {
    const pipeline = redis.multi().incr(key).expire(key, windowSeconds);
    const result = await pipeline.exec();

    if (!result) {
      throw new Error('Redis pipeline returned null');
    }
    const [incrRes] = result as Array<[Error | null, number]>;
    if (incrRes[0]) {
      throw incrRes[0];
    }
    const count = incrRes[1];
    return { count, exceeded: count > limit };
  } catch (err) {
    // Default policy is fail-open (a Redis outage shouldn't lock everyone
    // out). For brute-force-sensitive paths the caller can opt into
    // fail-closed via `failClosed` (see AUTH_RATE_LIMIT_FAIL_CLOSED) so an
    // outage doesn't silently disable the limiter on, e.g., magic-link verify.
    logger.error(
      { err, failClosed, key },
      failClosed
        ? 'Rate limit check failed — rejecting request (fail-closed)'
        : 'Rate limit check failed — allowing request (fail-open)',
    );
    return { count: 0, exceeded: failClosed };
  }
}

/**
 * Enforce per-email + per-IP limits on an unauthenticated auth mutation.
 *
 * - login:  5 req / hour / email, 20 req / hour / IP
 * - verify: 10 attempts / 15 min / email, 50 attempts / 15 min / IP
 *
 * The per-IP cap on `verify` matters because the per-email cap can be
 * trivially bypassed by an attacker who has a list of target emails:
 * 10 attempts/email × N emails = unbounded total attempts from one IP.
 * Capping per-IP closes that hole.
 *
 * IP is best-effort — requests without a forwarded IP only trip the
 * per-email limit.
 */
export async function checkAuthMutationLimit(
  kind: 'login' | 'verify',
  email: string,
  clientIp: string | null,
  failClosed = process.env.AUTH_RATE_LIMIT_FAIL_CLOSED === '1',
): Promise<{ exceeded: boolean }> {
  // E2E tests reuse a single fixture email and exceed the per-email
  // login cap (5/hour) within the first batch. The TEST_AUTH_CODE
  // bypass already short-circuits verifyMagicLink, so skipping the
  // cap here is consistent with that contract. We gate on TEST_AUTH_CODE
  // (only set by playwright.config.ts) rather than NODE_ENV, since
  // unit tests run with NODE_ENV=test and assert on the real limiter.
  if (process.env.TEST_AUTH_CODE) {
    return { exceeded: false };
  }

  const emailKey = `rl:auth:${kind}:email:${email.toLowerCase()}`;
  const ipKey = clientIp ? `rl:auth:${kind}:ip:${clientIp}` : null;

  if (kind === 'login') {
    const [byEmail, byIp] = await Promise.all([
      checkFixedWindow(emailKey, 5, 60 * 60, failClosed),
      ipKey
        ? checkFixedWindow(ipKey, 20, 60 * 60, failClosed)
        : Promise.resolve({ count: 0, exceeded: false }),
    ]);
    return { exceeded: byEmail.exceeded || byIp.exceeded };
  }

  const [byEmail, byIp] = await Promise.all([
    checkFixedWindow(emailKey, 10, 15 * 60, failClosed),
    ipKey
      ? checkFixedWindow(ipKey, 50, 15 * 60, failClosed)
      : Promise.resolve({ count: 0, exceeded: false }),
  ]);
  return { exceeded: byEmail.exceeded || byIp.exceeded };
}
