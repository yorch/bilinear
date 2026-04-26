import { GraphQLError } from 'graphql';
import { checkAuthMutationLimit } from '../../middleware/rate-limit';
import { OAuthError } from '../../services/auth.service';
import type { GraphQLContext } from '../context';

// Lightweight RFC-5321-ish format check. Intentionally permissive but blocks
// the most common abuse shapes (missing @, stray whitespace, overly long
// local-part or domain, control characters). Full RFC 5322 is not worth the
// complexity here; the magic link flow validates reachability by email.
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

function assertValidEmail(email: string): void {
  if (
    typeof email !== 'string' ||
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_RE.test(email)
  ) {
    throw new GraphQLError('Invalid email address', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
}

async function enforceAuthLimit(
  kind: 'login' | 'verify',
  email: string,
  ctx: GraphQLContext,
): Promise<void> {
  const { exceeded } = await checkAuthMutationLimit(kind, email, ctx.clientIp);
  if (exceeded) {
    throw new GraphQLError('Too many attempts. Please try again later.', {
      extensions: { code: 'RATELIMITED' },
    });
  }
}

// The AuthPayload service return includes `userId`; this resolver hydrates it
// into the `user: User!` field declared in the GraphQL schema.
export const authResolvers = {
  AuthPayload: {
    user: async (parent: { userId: string }, _args: unknown, ctx: GraphQLContext) => {
      const user = await ctx.services.user.findById(parent.userId);
      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return user;
    },
  },

  Mutation: {
    emailLogin: async (
      _parent: unknown,
      { input }: { input: { email: string } },
      ctx: GraphQLContext,
    ) => {
      assertValidEmail(input.email);
      await enforceAuthLimit('login', input.email, ctx);
      return ctx.services.auth.sendMagicLink(input.email);
    },

    emailVerify: async (
      _parent: unknown,
      { input }: { input: { email: string; code: string } },
      ctx: GraphQLContext,
    ) => {
      assertValidEmail(input.email);
      await enforceAuthLimit('verify', input.email, ctx);
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
      { code, state }: { code: string; state: string },
      ctx: GraphQLContext,
    ) => {
      try {
        return await ctx.services.auth.exchangeGoogleCode(code, state);
      } catch (err) {
        const error = err as Error;
        if (err instanceof OAuthError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'OAUTH_ERROR' },
          });
        }
        throw err;
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

  Query: {
    googleAuthStart: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      try {
        return await ctx.services.auth.startGoogleAuth();
      } catch (err) {
        if (err instanceof OAuthError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'OAUTH_ERROR' },
          });
        }
        throw err;
      }
    },
  },
};
