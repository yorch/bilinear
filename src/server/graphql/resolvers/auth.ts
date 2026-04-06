import { GraphQLError } from 'graphql';
import type { GraphQLContext } from '../context';

export const authResolvers = {
  Mutation: {
    emailLogin: async (
      _parent: unknown,
      { input }: { input: { email: string } },
      ctx: GraphQLContext,
    ) => {
      return ctx.services.auth.sendMagicLink(input.email);
    },

    emailVerify: async (
      _parent: unknown,
      { input }: { input: { email: string; code: string } },
      ctx: GraphQLContext,
    ) => {
      try {
        return await ctx.services.auth.verifyMagicLink(input.email, input.code);
      } catch (err) {
        const error = err as Error;
        if (error.name === 'InvalidCodeError') {
          throw new GraphQLError('Invalid or expired verification code', {
            extensions: { code: 'INVALID_CODE' },
          });
        }
        throw err;
      }
    },

    googleAuthExchange: async (
      _parent: unknown,
      { code, redirectUri }: { code: string; redirectUri: string },
      ctx: GraphQLContext,
    ) => {
      try {
        return await ctx.services.auth.exchangeGoogleCode(code, redirectUri);
      } catch (err) {
        const error = err as Error;
        throw new GraphQLError(error.message, {
          extensions: { code: 'OAUTH_ERROR' },
        });
      }
    },

    logout: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      if (ctx.userId) {
        await ctx.services.auth.logout(ctx.userId);
      }
      return { success: true };
    },

    tokenRefresh: async (
      _parent: unknown,
      { refreshToken }: { refreshToken: string },
      ctx: GraphQLContext,
    ) => {
      try {
        return await ctx.services.auth.refreshTokens(refreshToken);
      } catch (err) {
        const error = err as Error;
        if (error.name === 'InvalidTokenError') {
          throw new GraphQLError('Invalid or expired refresh token', {
            extensions: { code: 'INVALID_TOKEN' },
          });
        }
        throw err;
      }
    },
  },
};
