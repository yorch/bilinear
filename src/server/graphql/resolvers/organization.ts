import { GraphQLError } from 'graphql';
import { Prisma } from '../../../generated/prisma';
import {
  requireAuth,
  requireOrgRole,
  requireUserId,
} from '../../middleware/auth';
import type { GraphQLContext } from '../context';

const URL_KEY_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export const organizationResolvers = {
  Mutation: {
    organizationCreate: async (
      _parent: unknown,
      { input }: { input: { name: string; urlKey: string } },
      ctx: GraphQLContext,
    ) => {
      requireUserId(ctx);

      if (!URL_KEY_RE.test(input.urlKey)) {
        throw new GraphQLError(
          'URL key must be 3-63 characters, lowercase alphanumeric and hyphens only',
          { extensions: { code: 'BAD_USER_INPUT' } },
        );
      }

      const organization = await createOrgWithOwner(ctx, input);

      const tokenPair = await ctx.services.auth.reissueTokens(
        ctx.userId,
        organization.id,
      );

      return {
        accessToken: tokenPair.accessToken,
        expiresIn: tokenPair.expiresIn,
        organization,
        refreshToken: tokenPair.refreshToken,
        success: true,
      };
    },
    organizationMemberUpdateRole: async (
      _parent: unknown,
      { userId, role }: { userId: string; role: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, [
        'owner',
        'admin',
      ]);

      const VALID_ROLES = ['owner', 'admin', 'member', 'guest'];
      if (!VALID_ROLES.includes(role)) {
        throw new GraphQLError('Invalid role', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const membership = await ctx.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
      });
      if (!membership) {
        throw new GraphQLError('Member not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.prisma.organizationMember.update({
        data: { role },
        where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
      });
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'OrganizationMember',
        membership.id,
        { ...membership, role },
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },
  },

  Query: {
    organization: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const org = await ctx.services.user.getOrganizationForUser(ctx.userId);
      if (!org) {
        throw new GraphQLError('Organization not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return org;
    },

    organizationMembers: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.prisma.organizationMember.findMany({
        select: { role: true, userId: true },
        where: { organizationId: ctx.orgId },
      });
    },
  },
};

async function createOrgWithOwner(
  ctx: GraphQLContext & { userId: string },
  input: { name: string; urlKey: string },
) {
  try {
    return await ctx.prisma.$transaction(async tx => {
      const org = await tx.organization.create({
        data: { name: input.name, urlKey: input.urlKey },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          role: 'owner',
          userId: ctx.userId,
        },
      });

      return org;
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new GraphQLError('This URL key is already taken', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    throw err;
  }
}
