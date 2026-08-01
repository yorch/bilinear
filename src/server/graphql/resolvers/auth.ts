import { GraphQLError } from 'graphql';
import { isValidEmail } from '../../lib/email-address';
import { childLogger } from '../../lib/logger';
import { checkAuthMutationLimit } from '../../middleware/rate-limit';
import { OAuthError } from '../../services/auth.service';
import type { GraphQLContext } from '../context';

const log = childLogger({ module: 'resolver/auth' });

// Lightweight RFC-5321-ish format check. Intentionally permissive but blocks
// the most common abuse shapes (missing @, stray whitespace, overly long
// local-part or domain, control characters). Full RFC 5322 is not worth the
// complexity here; the magic link flow validates reachability by email.
function assertValidEmail(email: string): void {
  if (!isValidEmail(email)) {
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

/** Remap service-level OAuthError to the OAUTH_ERROR GraphQL code; rethrow the rest. */
function remapOAuthError(err: unknown): never {
  if (err instanceof OAuthError) {
    throw new GraphQLError(err.message, {
      extensions: { code: 'OAUTH_ERROR' },
    });
  }
  throw err;
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
        const result = await ctx.services.auth.verifyMagicLink(input.email, input.code);
        // Fire-and-forget audit log — errors are non-fatal. orgId is not
        // available from ctx at login time (no active session yet), so we
        // resolve it from the user's org membership asynchronously.
        if (result.userId) {
          (async () => {
            try {
              const org = await ctx.services.user.getOrganizationForUser(result.userId);
              if (org) {
                await ctx.services.auditLog.log({
                  action: 'auth.login',
                  ipAddress: ctx.clientIp,
                  metadata: { method: 'magic_link' },
                  orgId: org.id,
                  userId: result.userId,
                });
              }
            } catch (err) {
              log.warn({ err }, 'audit log failed');
            }
          })();
        }
        return result;
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

    githubAuthExchange: async (
      _parent: unknown,
      { code, state }: { code: string; state: string },
      ctx: GraphQLContext,
    ) => {
      try {
        return await ctx.services.auth.exchangeGithubCode(code, state);
      } catch (err) {
        remapOAuthError(err);
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
        remapOAuthError(err);
      }
    },

    logout: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      if (ctx.userId) {
        await ctx.services.auth.logout(ctx.userId);
        if (ctx.orgId) {
          ctx.services.auditLog
            .log({
              action: 'auth.logout',
              ipAddress: ctx.clientIp,
              orgId: ctx.orgId,
              userId: ctx.userId,
            })
            .catch(err => log.warn({ err }, 'audit log failed'));
        }
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
    githubAuthStart: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      try {
        return await ctx.services.auth.startGithubAuth();
      } catch (err) {
        remapOAuthError(err);
      }
    },

    googleAuthStart: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      try {
        return await ctx.services.auth.startGoogleAuth();
      } catch (err) {
        remapOAuthError(err);
      }
    },
  },
};
