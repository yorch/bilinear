import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_USER } from '../../../test/fixtures';

// These resolvers call `checkAuthMutationLimit`, which reaches the real Redis
// singleton. Without a mock these tests depend on how fast an *unreachable*
// Redis gives up: ioredis 5 surfaced ECONNREFUSED in ~100ms, so the limiter
// fell through to its fail-open branch well inside the 5s test budget and
// nobody noticed the dependency. ioredis 6 retries for ~850ms per command, and
// the two "user does not exist" paths make enough serial calls to blow past
// 5s — `emailVerify` takes over 20s. The `ci` job that runs `yarn test`
// provisions no service containers at all (only `e2e` does), so this is CI's
// normal state, not a local quirk.
//
// Mocking the singleton is also just correct: these tests assert resolver
// guard behaviour (no email enumeration, INVALID_CODE), and the limiter is
// incidental machinery on the way there. `rate-limit.test.ts` is where the
// limiter's own behaviour is pinned, against this same mock shape. A pipeline
// replying `[null, 1]` is one request in the window — under every cap, so the
// limiter reports not-exceeded, which is what these tests want and what they
// were accidentally getting from the fail-open path before.
//
// Declared through `vi.hoisted` rather than as plain consts: `vi.mock` is
// hoisted above the imports, and `src/server/config/index.ts` imports the
// redis singleton eagerly, so a plain const would still be uninitialised when
// the factory first runs.
const { multi } = vi.hoisted(() => {
  const runPipeline = vi.fn().mockResolvedValue([
    [null, 1],
    [null, 1],
  ]);
  const chain = {
    exec: runPipeline,
    expire: vi.fn().mockReturnThis(),
    incr: vi.fn().mockReturnThis(),
    incrby: vi.fn().mockReturnThis(),
  };
  return { multi: vi.fn(() => chain) };
});

vi.mock('../../lib/redis', () => ({
  redis: { multi },
}));

const { authResolvers } = await import('./auth');

describe('authResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('Mutation.emailLogin', () => {
    it('returns success when magic link is sent', async () => {
      // User already exists
      ctx.prisma.user.findUnique.mockResolvedValue(TEST_USER);
      ctx.prisma.authToken.updateMany.mockResolvedValue({ count: 0 });
      ctx.prisma.authToken.create.mockResolvedValue({} as never);

      const result = await authResolvers.Mutation.emailLogin(
        null,
        { input: { email: TEST_USER.email } },
        ctx as never,
      );

      expect(result.success).toBe(true);
    });

    it('returns success even when email is not registered (no enumeration)', async () => {
      // User doesn't exist — service should create a new one
      ctx.prisma.user.findUnique
        .mockResolvedValueOnce(null) // findByEmail
        .mockResolvedValueOnce(null); // findOrCreate inner lookup
      ctx.prisma.user.create.mockResolvedValue(TEST_USER);
      ctx.prisma.authToken.create.mockResolvedValue({} as never);

      const result = await authResolvers.Mutation.emailLogin(
        null,
        { input: { email: 'unknown@example.com' } },
        ctx as never,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Mutation.emailVerify', () => {
    it('throws INVALID_CODE when code is invalid', async () => {
      ctx.prisma.user.findUnique.mockResolvedValue(TEST_USER);
      // verifyMagicLink now claims the token atomically via updateMany —
      // a count of 0 means no matching live token was found.
      ctx.prisma.authToken.updateMany.mockResolvedValue({ count: 0 });

      try {
        await authResolvers.Mutation.emailVerify(
          null,
          { input: { code: '000000', email: TEST_USER.email } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('INVALID_CODE');
      }
    });

    it('throws INVALID_CODE when user does not exist', async () => {
      ctx.prisma.user.findUnique.mockResolvedValue(null);

      try {
        await authResolvers.Mutation.emailVerify(
          null,
          { input: { code: '123456', email: 'nobody@example.com' } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('INVALID_CODE');
      }
    });
  });

  describe('Mutation.tokenRefresh', () => {
    it('throws INVALID_TOKEN when refresh token is malformed', async () => {
      try {
        await authResolvers.Mutation.tokenRefresh(
          null,
          { refreshToken: 'not-a-valid-jwt' },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('INVALID_TOKEN');
      }
    });
  });

  describe('Mutation.googleAuthExchange', () => {
    it('throws OAUTH_ERROR when the state token is invalid', async () => {
      try {
        await authResolvers.Mutation.googleAuthExchange(
          null,
          { code: 'bad-code', state: 'not-a-jwt' },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('OAUTH_ERROR');
      }
    });
  });

  describe('Mutation.githubAuthExchange', () => {
    it('throws OAUTH_ERROR when the state token is invalid', async () => {
      try {
        await authResolvers.Mutation.githubAuthExchange(
          null,
          { code: 'bad-code', state: 'not-a-jwt' },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('OAUTH_ERROR');
      }
    });
  });

  describe('Mutation.logout', () => {
    it('revokes tokens and returns success when authenticated', async () => {
      ctx.prisma.authToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await authResolvers.Mutation.logout(null, {}, ctx as never);

      expect(result.success).toBe(true);
      expect(ctx.prisma.authToken.updateMany).toHaveBeenCalled();
    });

    it('returns success without DB call when not authenticated', async () => {
      ctx = createMockContext({ userId: null });

      const result = await authResolvers.Mutation.logout(null, {}, ctx as never);

      expect(result.success).toBe(true);
      expect(ctx.prisma.authToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('AuthPayload.user field resolver', () => {
    it('returns the user for the given userId', async () => {
      ctx.prisma.user.findUnique.mockResolvedValue(TEST_USER);

      const result = await authResolvers.AuthPayload.user(
        { userId: TEST_USER.id },
        {},
        ctx as never,
      );

      expect(result).toEqual(TEST_USER);
    });

    it('throws NOT_FOUND when user does not exist', async () => {
      ctx.prisma.user.findUnique.mockResolvedValue(null);

      try {
        await authResolvers.AuthPayload.user({ userId: 'nonexistent-id' }, {}, ctx as never);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });
  });
});
