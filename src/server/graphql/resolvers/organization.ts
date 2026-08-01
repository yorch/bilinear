import { GraphQLError } from 'graphql';
import type { Organization, OrganizationMember } from '../../../generated/prisma';
import { childLogger } from '../../lib/logger';
import { requireAuth, requireOrgRole, requireUserId } from '../../middleware/auth';
import {
  InvalidRoleError,
  InvalidUrlKeyError,
  MemberNotFoundError,
  UrlKeyTakenError,
} from '../../services/organization.service';
import type { GraphQLContext } from '../context';

const log = childLogger({ module: 'resolver/organization' });

export const organizationResolvers = {
  Mutation: {
    aiSettingsUpdate: async (
      _parent: unknown,
      { enabled }: { enabled: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      const organization = await ctx.prisma.organization.update({
        data: { aiEnabled: enabled },
        where: { id: ctx.orgId },
      });
      // Organization is part of the synced dataset — broadcast so other
      // clients pick up the toggle without a refresh. Strip the two settings
      // blobs first: this payload goes to every client in the org over the WS
      // fan-out, and `getBootstrapData` omits them for exactly that reason.
      const { authSettings, securitySettings, ...broadcastable } = organization;
      void authSettings;
      void securitySettings;
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Organization',
        organization.id,
        broadcastable,
      );
      return { lastSyncId: sync.id.toString(), organization, success: true };
    },

    organizationCreate: async (
      _parent: unknown,
      { input }: { input: { name: string; urlKey: string } },
      ctx: GraphQLContext,
    ) => {
      requireUserId(ctx);

      let organization: Organization;
      try {
        organization = await ctx.services.organization.createWithOwner(ctx.userId, input);
      } catch (err) {
        if (err instanceof InvalidUrlKeyError || err instanceof UrlKeyTakenError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }

      const tokenPair = await ctx.services.auth.reissueTokens(ctx.userId, organization.id);

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
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);

      let updated: OrganizationMember;
      try {
        updated = await ctx.services.organization.updateMemberRole(ctx.orgId, userId, role);
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

      // Fire-and-forget audit log — errors are non-fatal
      ctx.services.auditLog
        .log({
          action: 'member.role_changed',
          ipAddress: ctx.clientIp,
          metadata: { newRole: role, targetUserId: userId },
          orgId: ctx.orgId,
          resourceId: userId,
          resourceType: 'OrganizationMember',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      return { lastSyncId: sync.id.toString(), success: true };
    },
  },

  Query: {
    organization: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const org = await ctx.services.user.getOrganizationForUser(ctx.userId);
      if (!org) {
        throw new GraphQLError('Organization not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return org;
    },

    organizationMembers: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.organization.findMembers(ctx.orgId);
    },
  },
};
