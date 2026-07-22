import { randomUUID } from 'node:crypto';
import type { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import type { GraphQLFormattedError } from 'graphql';
import { GraphQLError } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import type { ComplexityEstimator } from 'graphql-query-complexity';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';
import { NextRequest } from 'next/server';
import type { GraphQLContext } from '@/server/graphql/context';
import { createContext } from '@/server/graphql/context';
import { resolvers } from '@/server/graphql/resolvers';
import { typeDefs } from '@/server/graphql/schema';
import { env } from '@/server/lib/env';
import { MAX_LIST_LIMIT } from '@/server/lib/limits';
import { logger, runWithRequestContext } from '@/server/lib/logger';
import { isOriginStringAllowed } from '@/server/lib/request-security';
import {
  buildRateLimitedResponse,
  checkRateLimit,
  estimateComplexity,
  withRateLimitHeaders,
} from '@/server/middleware/rate-limit';
import { apiScopesAllowWrite } from '@/server/services/auth.service';

// Hard caps enforced by GraphQL validation rules — reject queries before any
// resolver runs. Complementary to the per-user rate limiter in rate-limit.ts,
// which tracks request budget over a 1-hour window.
const MAX_QUERY_DEPTH = 10;
const MAX_QUERY_COMPLEXITY = 1000;

// Cap applied to any `first`/`limit`/`last` argument value when it's used as
// a complexity multiplier below, so a client-claimed absurd page size (e.g.
// `first: 999999`) can't be used to either (a) fan out real cost unbounded
// or (b) inflate the *computed* complexity number itself into overflow/
// nonsense territory. Deliberately reuses MAX_LIST_LIMIT — the same ceiling
// every list resolver already clamps to at runtime (see clampLimit) — so a
// caller can never be penalized in the complexity check beyond what the
// server would actually let them page through. Tune alongside MAX_LIST_LIMIT
// if that ceiling ever changes.
const MAX_LIST_COMPLEXITY_MULTIPLIER = MAX_LIST_LIMIT;

// GraphQL error codes that represent expected client-side conditions (bad
// input, auth, not-found, …) rather than a server fault. These are logged at
// debug; anything else (no code, INTERNAL_SERVER_ERROR) is a server error.
const CLIENT_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_USER_INPUT',
  'INVALID_CODE',
  'INVALID_TOKEN',
  'RATELIMITED',
  // Thrown by resolvers/auth.ts's remapOAuthError (e.g. "Invalid or expired
  // OAuth state", "no verified email") — a client-fault from a bad/expired
  // OAuth callback, never internal state, so it belongs alongside the other
  // auth-flow codes above (both for formatError passthrough and so it's
  // logged at debug rather than flagged as a server fault).
  'OAUTH_ERROR',
]);

// Codes that are readable to the client even though they aren't in
// CLIENT_ERROR_CODES above (that set drives server-error *logging*; this one
// drives response *masking* in formatError). Graphql-js itself stamps parse
// and validation failures with these codes before any resolver runs — they
// describe a malformed request, never internal state, so passing the
// message through is safe and expected (e.g. "Cannot query field 'x' on
// type 'Y'").
const CLIENT_READABLE_ERROR_CODES = new Set(['GRAPHQL_PARSE_FAILED', 'GRAPHQL_VALIDATION_FAILED']);

// Requests at/above this duration are always logged even when sampling is on.
const SLOW_REQUEST_MS = 1000;

// Fraction of successful, fast requests to emit an access log for (0..1).
// Server-side errors and slow requests bypass sampling and are always logged.
// Defaults to 1 (log everything); lower it (e.g. LOG_HTTP_SAMPLE_RATE=0.1) at
// high volume. An explicitly-empty value (`LOG_HTTP_SAMPLE_RATE=`) is treated
// as unset so a blank env var doesn't silently disable all sampled logs.
// Validation lives in `env.ts` (`env.LOG_HTTP_SAMPLE_RATE`).
const HTTP_LOG_SAMPLE_RATE = env.LOG_HTTP_SAMPLE_RATE;

/**
 * List-aware complexity estimator. The schema has no per-field `complexity`
 * extensions (so `fieldExtensionsEstimator` below is a structural no-op — it
 * always falls through), and `simpleEstimator` treats every field as cost 1
 * regardless of how many rows it can return — so `issues(first: 10000) {
 * assignee { ... } }` costs the same as `issues(first: 1) { assignee { ... }
 * }` even though the former can fan out its child selection thousands of
 * times over. This estimator multiplies a field's child complexity by its
 * `first`/`limit`/`last` argument (when present and numeric), capped at
 * MAX_LIST_COMPLEXITY_MULTIPLIER so a legitimate large-but-bounded page
 * request is never penalized beyond the server's own enforced ceiling.
 *
 * Deliberately conservative: fields with no first/limit/last arg (the vast
 * majority — every non-list field, plus list fields with no pagination arg)
 * get multiplier 1, i.e. byte-identical behavior to the old
 * `simpleEstimator`-only setup. Only list queries that actually request a
 * page size change complexity at all, so the app's existing bootstrap/list
 * queries (which all page well under MAX_LIST_LIMIT — see PATTERNS.md /
 * clampLimit call sites) are unaffected.
 *
 * Tuning caveat: this is a heuristic, not a precise cost model — it doesn't
 * know a field's actual DB fan-out (e.g. an N+1 relation) or weight nested
 * lists multiplicatively beyond the single level graphql-query-complexity
 * already recurses through via childComplexity. If a legitimate query still
 * gets rejected in practice, prefer raising MAX_QUERY_COMPLEXITY or this
 * estimator's cap over removing the guard.
 */
function listArgumentEstimator(): ComplexityEstimator {
  return ({ args, childComplexity }) => {
    const rawArg = (args?.first ?? args?.limit ?? args?.last) as unknown;
    let multiplier = 1;
    if (typeof rawArg === 'number' && Number.isFinite(rawArg) && rawArg > 1) {
      multiplier = Math.min(Math.floor(rawArg), MAX_LIST_COMPLEXITY_MULTIPLIER);
    }
    // Matches simpleEstimator's own `defaultComplexity + childComplexity`
    // shape (defaultComplexity 1) when multiplier is 1, so a field with no
    // list arg costs exactly what it did before this change.
    return 1 + multiplier * childComplexity;
  };
}

/**
 * Apollo plugin: one structured access log per operation (operationName,
 * type, duration, HTTP status, error count) plus an error-level log for any
 * server-side fault. Runs for every request — authenticated or not — so
 * failures and anonymous traffic are visible, unlike the old per-request
 * line that only fired for authenticated requests.
 */
const observabilityPlugin: ApolloServerPlugin<GraphQLContext> = {
  async requestDidStart(): Promise<GraphQLRequestListener<GraphQLContext>> {
    const startedAt = Date.now();
    let errorCount = 0;
    let serverErrorCount = 0;
    return {
      async didEncounterErrors(rc) {
        errorCount = rc.errors.length;
        for (const err of rc.errors) {
          const code = err.extensions?.code;
          if (typeof code === 'string' && CLIENT_ERROR_CODES.has(code)) {
            continue;
          }
          serverErrorCount++;
          logger.error(
            { code: code ?? null, err, operationName: rc.operationName ?? null },
            'GraphQL resolver error',
          );
        }
      },
      async willSendResponse(rc) {
        const durationMs = Date.now() - startedAt;
        const status = rc.response.http?.status ?? 200;
        const slow = durationMs >= SLOW_REQUEST_MS;
        const sampled = HTTP_LOG_SAMPLE_RATE >= 1 || Math.random() < HTTP_LOG_SAMPLE_RATE;
        // Bypass sampling for server-side faults and slow requests only —
        // client errors (UNAUTHENTICATED, NOT_FOUND, …) are ordinary traffic
        // and must stay sample-able, else lowering the rate wouldn't cut the
        // highest-volume case. The full errorCount is still recorded.
        if (serverErrorCount > 0 || slow || sampled) {
          logger.info(
            {
              durationMs,
              errorCount,
              operationName: rc.operationName ?? null,
              operationType: rc.operation?.operation ?? null,
              serverErrorCount,
              slow,
              status,
            },
            'GraphQL request',
          );
        }
      },
    };
  },
};

/**
 * Cache the GraphQL context per request so we only call createContext once.
 * Apollo's context callback and the rate-limit check both need the context,
 * but createContext does JWT verification + service instantiation on every
 * call — we want exactly one invocation per HTTP request.
 */
const requestContextCache = new WeakMap<Request, GraphQLContext>();

const server = new ApolloServer<GraphQLContext>({
  // CSRF prevention: rejects POSTs missing a preflight-triggering header
  // (Content-Type !== application/json, or no Apollo-Require-Preflight).
  // Auth is taken from the httpOnly cookie, so without this an attacker
  // page could POST a multipart/form-urlencoded body to /api/graphql with
  // the user's cookie attached and trigger mutations. SameSite=lax helps
  // for top-level navigations but not for sub-resource POSTs.
  csrfPrevention: true,
  // No error masking previously meant unmapped errors (raw Prisma P2002/
  // P2023, unexpected throws, …) reached the client as-is — message and
  // extensions included, e.g. Prisma's own message which can quote SQL
  // column/table names. Known client-fault codes are already deliberate,
  // hand-written GraphQLErrors (see CLIENT_ERROR_CODES / mapServiceError) —
  // pass those through untouched. Everything else gets collapsed to a
  // single generic message with no extensions beyond a stable code, so
  // internals never leak. The original error is already logged server-side
  // by observabilityPlugin's didEncounterErrors hook above (which runs
  // before formatError, on the pre-masking error) — nothing here re-logs it.
  formatError(formattedError: GraphQLFormattedError): GraphQLFormattedError {
    const code =
      typeof formattedError.extensions?.code === 'string'
        ? formattedError.extensions.code
        : undefined;
    if (code && (CLIENT_ERROR_CODES.has(code) || CLIENT_READABLE_ERROR_CODES.has(code))) {
      return formattedError;
    }
    return {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
      locations: formattedError.locations,
      message: 'Internal server error',
      path: formattedError.path,
    };
  },
  plugins: [
    observabilityPlugin,
    {
      // Origin allow-list: even with csrfPrevention, lock down the set of
      // origins that can hit /api/graphql. Locks out third-party sites
      // sending POSTs with `apollo-require-preflight` headers from
      // arbitrary contexts. Same-origin requests have an empty/null Origin
      // on some browsers, so allow no-Origin too.
      async requestDidStart({ contextValue: _ctx, request }) {
        const origin = request.http?.headers.get('origin') ?? null;
        if (!isOriginStringAllowed(origin)) {
          throw new GraphQLError('Origin not allowed', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        return {};
      },
    },
    {
      // API-key scope enforcement: a request authenticated with a key that
      // lacks the `write` scope may run queries but not mutations. Centralised
      // here so every mutation is covered without per-resolver checks.
      async requestDidStart() {
        return {
          async didResolveOperation({ contextValue, operation }) {
            if (operation?.operation !== 'mutation') {
              return;
            }
            const scopes = contextValue.apiKeyScopes ?? null;
            if (scopes !== null && !apiScopesAllowWrite(scopes)) {
              throw new GraphQLError('API key lacks the "write" scope', {
                extensions: { code: 'FORBIDDEN' },
              });
            }
          },
        };
      },
    },
    {
      // Complexity has to be evaluated per request because the limit
      // depends on actual variable values; running it as a static
      // validationRule rejects every mutation with required input
      // variables (no variables are available before parsing).
      async requestDidStart() {
        return {
          async didResolveOperation({ request, document, schema }) {
            const complexity = getComplexity({
              // Order matters — the first estimator to return a defined
              // number for a field wins. fieldExtensionsEstimator is a
              // no-op today (no field in the schema declares a `complexity`
              // extension) but costs nothing to keep first, in case one is
              // added later. listArgumentEstimator applies the
              // first/limit/last multiplier described above. simpleEstimator
              // is the final fallback, unchanged from before.
              estimators: [
                fieldExtensionsEstimator(),
                listArgumentEstimator(),
                simpleEstimator({ defaultComplexity: 1 }),
              ],
              operationName: request.operationName ?? undefined,
              query: document,
              schema,
              variables: request.variables ?? {},
            });
            if (complexity > MAX_QUERY_COMPLEXITY / 2) {
              logger.warn({ complexity }, 'High GraphQL query complexity');
            }
            if (complexity > MAX_QUERY_COMPLEXITY) {
              // Use BAD_USER_INPUT to match the CLAUDE.md error-code
              // discriminator list — clients already know how to handle
              // it. The detail (computed vs allowed complexity) goes in
              // the message.
              throw new GraphQLError(
                `Query is too complex: ${complexity}. Maximum allowed: ${MAX_QUERY_COMPLEXITY}`,
                { extensions: { code: 'BAD_USER_INPUT' } },
              );
            }
          },
        };
      },
    },
  ],
  resolvers,
  typeDefs,
  validationRules: [depthLimit(MAX_QUERY_DEPTH)],
});

const handler = startServerAndCreateNextHandler<NextRequest, GraphQLContext>(server, {
  context: async req => {
    // Return the already-built context from the WeakMap if present;
    // fall back to creating one (handles edge cases like Apollo playground).
    return requestContextCache.get(req) ?? createContext(req);
  },
});

async function handleRequest(req: NextRequest): Promise<Response> {
  // Build context once — createContext only reads headers/cookies, never the body.
  const ctx = await createContext(req);

  // Establish request-scoped log bindings (requestId + who) so every log line
  // emitted while handling this request — including deep in services — can be
  // correlated. See logger.ts `mixin`.
  const bindings: Record<string, unknown> = { requestId: randomUUID() };
  if (ctx.orgId) {
    bindings.orgId = ctx.orgId;
  }
  if (ctx.userId) {
    bindings.userId = ctx.userId;
  }

  return runWithRequestContext(bindings, async () => {
    // Rate-limit authenticated requests only.
    if (ctx.userId) {
      // req.body is a one-shot ReadableStream. Avoid req.clone() — tee semantics
      // are unreliable in some Node.js / Next.js versions and can leave Apollo's
      // handler with an empty body (SyntaxError: Unexpected end of JSON input).
      // Instead, read the body text once and reconstruct a fresh request for Apollo.
      let bodyText = '';
      let body: { query?: string; variables?: Record<string, unknown> } = {};
      try {
        bodyText = await req.text();
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        // Non-JSON or empty body — proceed without complexity estimate.
      }

      const complexity = estimateComplexity(body);
      const { exceeded, headers } = await checkRateLimit(ctx.userId, complexity);

      if (exceeded) {
        logger.warn({ complexity }, 'Rate limit exceeded');
        return buildRateLimitedResponse(headers);
      }

      // Reconstruct a new request with the buffered body so Apollo can read it.
      const reqForApollo = new NextRequest(req.url, {
        body: bodyText || null,
        headers: req.headers,
        method: req.method,
      });
      requestContextCache.set(reqForApollo, ctx);
      const response = await handler(reqForApollo);
      // Return a cloned response with rate-limit headers (Response is immutable).
      // The per-operation access log is emitted by observabilityPlugin.
      return withRateLimitHeaders(response, headers);
    }

    requestContextCache.set(req, ctx);
    return handler(req);
  });
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}
