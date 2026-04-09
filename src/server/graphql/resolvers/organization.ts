import { GraphQLError } from 'graphql';
import { requireAuth, requireUserId } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const organizationResolvers = {
  Mutation: {
    organizationCreate: async (
      _parent: unknown,
      { input }: { input: { name: string; urlKey: string } },
      ctx: GraphQLContext,
    ) => {
      requireUserId(ctx);

      // Validate urlKey format: lowercase alphanumeric + hyphens, 3-63 chars
      const urlKeyRe = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
      if (!urlKeyRe.test(input.urlKey)) {
        throw new GraphQLError(
          'URL key must be 3-63 characters, lowercase alphanumeric and hyphens only',
          { extensions: { code: 'BAD_USER_INPUT' } },
        );
      }

      // Check uniqueness
      const existing = await ctx.prisma.organization.findUnique({
        where: { urlKey: input.urlKey },
      });
      if (existing) {
        throw new GraphQLError('This URL key is already taken', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Create org + owner membership in a transaction
      const organization = await ctx.prisma.$transaction(async tx => {
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

      // Re-issue tokens so the JWT now contains the new orgId
      const tokenPair = await ctx.services.auth.issueTokenPair(ctx.userId);

      return {
        accessToken: tokenPair.accessToken,
        expiresIn: tokenPair.expiresIn,
        organization,
        refreshToken: tokenPair.refreshToken,
        success: true,
      };
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
  },
};
