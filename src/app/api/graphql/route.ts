import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { GraphQLError } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';
import type { NextRequest } from 'next/server';
import type { GraphQLContext } from '../../../server/graphql/context';
import { createContext } from '../../../server/graphql/context';
import { resolvers } from '../../../server/graphql/resolvers';
import { typeDefs } from '../../../server/graphql/schema';
import { logger } from '../../../server/lib/logger';
import {
  buildRateLimitedResponse,
  checkRateLimit,
  estimateComplexity,
  withRateLimitHeaders,
} from '../../../server/middleware/rate-limit';

// Hard caps enforced by GraphQL validation rules — reject queries before any
// resolver runs. Complementary to the per-user rate limiter in rate-limit.ts,
// which tracks request budget over a 1-hour window.
const MAX_QUERY_DEPTH = 10;
const MAX_QUERY_COMPLEXITY = 1000;

/**
 * Resolve the allow-list of Origins permitted to hit `/api/graphql`.
 * Built from `APP_URL` plus any additional comma-separated entries in
 * `GRAPHQL_ALLOWED_ORIGINS` (e.g. preview deployments). Returning an
 * empty list disables the check — useful in tests where the request
 * arrives with no Origin header.
 */
function getAllowedOrigins(): string[] {
  const fromEnv: string[] = [];
  if (process.env.APP_URL) {
    fromEnv.push(process.env.APP_URL.replace(/\/$/, ''));
  }
  if (process.env.GRAPHQL_ALLOWED_ORIGINS) {
    for (const o of process.env.GRAPHQL_ALLOWED_ORIGINS.split(',')) {
      const trimmed = o.trim().replace(/\/$/, '');
      if (trimmed) {
        fromEnv.push(trimmed);
      }
    }
  }
  return fromEnv;
}

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
  plugins: [
    {
      // Origin allow-list: even with csrfPrevention, lock down the set of
      // origins that can hit /api/graphql. Locks out third-party sites
      // sending POSTs with `apollo-require-preflight` headers from
      // arbitrary contexts. Same-origin requests have an empty/null Origin
      // on some browsers, so allow no-Origin too.
      async requestDidStart({ contextValue: _ctx, request }) {
        const origin = request.http?.headers.get('origin') ?? null;
        const allowed = getAllowedOrigins();
        if (origin && allowed.length > 0 && !allowed.includes(origin)) {
          throw new GraphQLError('Origin not allowed', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        return {};
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
              estimators: [simpleEstimator({ defaultComplexity: 1 })],
              operationName: request.operationName ?? undefined,
              query: document,
              schema,
              variables: request.variables ?? {},
            });
            if (complexity > MAX_QUERY_COMPLEXITY / 2) {
              logger.warn({ complexity }, 'High GraphQL query complexity');
            }
            if (complexity > MAX_QUERY_COMPLEXITY) {
              throw new GraphQLError(
                `Query is too complex: ${complexity}. Maximum allowed: ${MAX_QUERY_COMPLEXITY}`,
                { extensions: { code: 'QUERY_TOO_COMPLEX' } },
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
  // Build context once and cache it so Apollo doesn't rebuild it.
  const ctx = await createContext(req);
  requestContextCache.set(req, ctx);

  // Rate-limit authenticated requests only.
  if (ctx.userId) {
    let body: { query?: string; variables?: Record<string, unknown> } = {};
    try {
      body = (await req.clone().json()) as typeof body;
    } catch {
      // Non-JSON or empty body — proceed without complexity estimate.
    }

    const complexity = estimateComplexity(body);
    const { exceeded, headers } = await checkRateLimit(ctx.userId, complexity);

    if (exceeded) {
      logger.warn({ complexity, userId: ctx.userId }, 'Rate limit exceeded');
      return buildRateLimitedResponse(headers);
    }

    const response = await handler(req);
    logger.info({ complexity, method: req.method, userId: ctx.userId }, 'GraphQL request');
    // Return a cloned response with rate-limit headers (Response is immutable).
    return withRateLimitHeaders(response, headers);
  }

  return handler(req);
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}
