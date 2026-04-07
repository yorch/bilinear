import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import type { NextRequest } from 'next/server';
import type { GraphQLContext } from '../../../server/graphql/context';
import { createContext } from '../../../server/graphql/context';
import { resolvers } from '../../../server/graphql/resolvers';
import { typeDefs } from '../../../server/graphql/schema';
import { logger } from '../../../server/lib/logger';
import {
  applyRateLimitHeaders,
  buildRateLimitedResponse,
  checkRateLimit,
  estimateComplexity,
} from '../../../server/middleware/rate-limit';

const server = new ApolloServer<GraphQLContext>({
  resolvers,
  typeDefs,
});

const handler = startServerAndCreateNextHandler<NextRequest, GraphQLContext>(
  server,
  {
    context: async req => createContext(req),
  },
);

async function handleRequest(req: NextRequest): Promise<Response> {
  const ctx = await createContext(req);

  // Only rate-limit authenticated requests
  if (ctx.userId) {
    let body: { query?: string; variables?: Record<string, unknown> } = {};
    try {
      body = (await req.clone().json()) as typeof body;
    } catch {
      // body parse failed — proceed without complexity estimate
    }

    const complexity = estimateComplexity(body);
    const { exceeded, headers } = await checkRateLimit(ctx.userId, complexity);

    if (exceeded) {
      logger.warn({ complexity, userId: ctx.userId }, 'Rate limit exceeded');
      return buildRateLimitedResponse(headers);
    }

    const response = await handler(req);
    applyRateLimitHeaders(response, headers);
    logger.info(
      { complexity, method: req.method, userId: ctx.userId },
      'GraphQL request',
    );
    return response;
  }

  return handler(req);
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}
