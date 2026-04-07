import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
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

/**
 * Cache the GraphQL context per request so we only call createContext once.
 * Apollo's context callback and the rate-limit check both need the context,
 * but createContext does JWT verification + service instantiation on every
 * call — we want exactly one invocation per HTTP request.
 */
const requestContextCache = new WeakMap<Request, GraphQLContext>();

const server = new ApolloServer<GraphQLContext>({
  resolvers,
  typeDefs,
});

const handler = startServerAndCreateNextHandler<NextRequest, GraphQLContext>(
  server,
  {
    context: async req => {
      // Return the already-built context from the WeakMap if present;
      // fall back to creating one (handles edge cases like Apollo playground).
      return requestContextCache.get(req) ?? createContext(req);
    },
  },
);

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
    logger.info(
      { complexity, method: req.method, userId: ctx.userId },
      'GraphQL request',
    );
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
