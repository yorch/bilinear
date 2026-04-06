import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import type { NextRequest } from 'next/server';
import type { GraphQLContext } from '../../../server/graphql/context';
import { createContext } from '../../../server/graphql/context';
import { resolvers } from '../../../server/graphql/resolvers';
import { typeDefs } from '../../../server/graphql/schema';

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

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}
