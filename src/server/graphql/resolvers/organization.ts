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
    organizationSwitch: async (
      _parent: unknown,
      { organizationId }: { organizationId: string },
      ctx: GraphQLContext,
    ) => {
      // `requireUserId`, not `requireAuth`: switching away is exactly what a
      // user whose current org went suspended (or who was removed from it)
      // needs to do, and those sessions carry a null `orgId`.
      requireUserId(ctx);

      // Membership is re-read here rather than trusted from the client. This
      // is the whole authorization for the mutation — without it, any
      // authenticated user could mint a session for an arbitrary org id.
      const membership = await ctx.services.user.findUsableMembership(ctx.userId, organizationId);
      if (!membership) {
        throw new GraphQLError('Organization not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // Refuse while impersonating, for the same reason API-key creation is
      // refused: an admin acting as someone else must not be able to steer
      // that session into another of the target's workspaces, which would
      // take the impersonation somewhere the audit trail did not record.
      if (ctx.impersonatorId) {
        throw new GraphQLError('Cannot switch workspaces while impersonating', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      const tokenPair = await ctx.services.auth.reissueTokens(ctx.userId, organizationId);

      return {
        accessToken: tokenPair.accessToken,
        expiresIn: tokenPair.expiresIn,
        organization: membership.organization,
        refreshToken: tokenPair.refreshToken,
        success: true,
      };
    },
  },

  Query: {
    organization: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      // Resolved from the session's org, not from "the user's first
      // membership" — those coincide only for single-org accounts. With
      // several memberships the old lookup returned the oldest one, so a
      // user working in their second workspace saw their first workspace's
      // name, url key, and feature flags on the settings page.
      const org = await ctx.prisma.organization.findUnique({ where: { id: ctx.orgId } });
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

    viewerOrganizations: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      // See the schema doc: deliberately reachable without an active org.
      requireUserId(ctx);
      const rows = await ctx.services.user.listOrganizationsForUser(ctx.userId);
      return rows.map(({ organization, role }) => ({
        current: organization.id === ctx.orgId,
        id: organization.id,
        logoUrl: organization.logoUrl,
        name: organization.name,
        role,
        urlKey: organization.urlKey,
      }));
    },
  },
};
