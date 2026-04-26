import { GraphQLError } from 'graphql';
import type {
  Organization,
  OrganizationMember,
} from '../../../generated/prisma';
import {
  requireAuth,
  requireOrgRole,
  requireUserId,
} from '../../middleware/auth';
import {
  InvalidRoleError,
  InvalidUrlKeyError,
  MemberNotFoundError,
  UrlKeyTakenError,
} from '../../services/organization.service';
import type { GraphQLContext } from '../context';

export const organizationResolvers = {
  Mutation: {
    organizationCreate: async (
      _parent: unknown,
      { input }: { input: { name: string; urlKey: string } },
      ctx: GraphQLContext,
    ) => {
      requireUserId(ctx);

      let organization: Organization;
      try {
        organization = await ctx.services.organization.createWithOwner(
          ctx.userId,
          input,
        );
      } catch (err) {
        if (
          err instanceof InvalidUrlKeyError ||
          err instanceof UrlKeyTakenError
        ) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }

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

      let updated: OrganizationMember;
      try {
        updated = await ctx.services.organization.updateMemberRole(
          ctx.orgId,
          userId,
          role,
        );
      } catch (err) {
        if (err instanceof InvalidRoleError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        if (err instanceof MemberNotFoundError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }

      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'OrganizationMember',
        updated.id,
        updated,
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
      return ctx.services.organization.findMembers(ctx.orgId);
    },
  },
};
