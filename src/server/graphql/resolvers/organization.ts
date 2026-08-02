import { GraphQLError } from 'graphql';
import type { Organization, OrganizationMember } from '../../../generated/prisma';
import { childLogger } from '../../lib/logger';
import { announceJoin, broadcastMembership } from '../../lib/membership-sync';
import { clearOrgSession, requireAuth, requireOrgRole, requireUserId } from '../../middleware/auth';
import {
  CannotRemoveSelfError,
  InvalidRoleError,
  InvalidUrlKeyError,
  LastOwnerError,
  MemberNotFoundError,
  OwnerRoleRequiredError,
  UrlKeyTakenError,
} from '../../services/organization.service';
import {
  AlreadyMemberError,
  InvalidInviteEmailError,
  InviteEmailFailedError,
  InviteEmailMismatchError,
  InviteNotFoundError,
  InviteRoleNotAllowedError,
  TooManyInvitesError,
} from '../../services/organization-invite.service';
import type { GraphQLContext } from '../context';

const log = childLogger({ module: 'resolver/organization' });

/**
 * Re-issue the caller's session against `organization` and build the shared
 * `EnterOrganizationPayload`. Creating a workspace, switching to one, and
 * accepting an invitation to one all end this way; the tail was written out
 * three times, which is one place per way for it to drift.
 */
async function enterOrganization(
  ctx: GraphQLContext & { userId: string },
  organization: Organization,
) {
  const tokenPair = await ctx.services.auth.reissueTokens(ctx.userId, organization.id);
  return {
    accessToken: tokenPair.accessToken,
    expiresIn: tokenPair.expiresIn,
    organization,
    refreshToken: tokenPair.refreshToken,
    success: true,
  };
}

/**
 * Map the membership-management service errors onto GraphQL codes. They all
 * surface through the same members UI, so keeping the mapping in one place
 * stops the four mutations that raise them from drifting apart.
 */
function rethrowMembershipError(err: unknown): never {
  if (
    err instanceof InvalidRoleError ||
    err instanceof InvalidInviteEmailError ||
    err instanceof AlreadyMemberError ||
    err instanceof TooManyInvitesError ||
    err instanceof CannotRemoveSelfError ||
    err instanceof LastOwnerError
  ) {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  if (err instanceof OwnerRoleRequiredError || err instanceof InviteRoleNotAllowedError) {
    throw new GraphQLError(err.message, { extensions: { code: 'FORBIDDEN' } });
  }
  if (err instanceof MemberNotFoundError) {
    throw new GraphQLError(err.message, { extensions: { code: 'NOT_FOUND' } });
  }
  if (err instanceof InviteEmailFailedError) {
    // The invitation was rolled back, so this is actionable: the admin can
    // retry. Passed through `formatError` rather than masked — see the
    // EMAIL_SEND_FAILED entry in CLIENT_ERROR_CODES.
    throw new GraphQLError(err.message, { extensions: { code: 'EMAIL_SEND_FAILED' } });
  }
  throw err;
}

export const organizationResolvers = {
  Mutation: {
    aiSettingsUpdate: async (
      _parent: unknown,
      { enabled }: { enabled: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      requireOrgRole(ctx, ['owner', 'admin']);
      const organization = await ctx.prisma.organization.update({
        data: { aiEnabled: enabled },
        where: { id: ctx.orgId },
      });
      // Organization is part of the synced dataset — broadcast so other clients
      // pick up the toggle without a refresh. The settings blobs are stripped
      // centrally by `recordSyncAction` (see SYNC_PAYLOAD_OMITTED_FIELDS), so
      // this passes the row through rather than filtering it here.
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Organization',
        organization.id,
        organization,
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

      return enterOrganization(ctx, organization);
    },

    organizationInviteAccept: async (
      _parent: unknown,
      { token }: { token: string },
      ctx: GraphQLContext,
    ) => {
      // `requireUserId`: the accepting session is frequently a brand-new
      // account with no organization at all, so it has no `orgId` to require.
      requireUserId(ctx);

      let accepted: Awaited<ReturnType<typeof ctx.services.organizationInvite.accept>>;
      try {
        accepted = await ctx.services.organizationInvite.accept(token, ctx.userId);
      } catch (err) {
        if (err instanceof InviteNotFoundError) {
          throw new GraphQLError(err.message, { extensions: { code: 'NOT_FOUND' } });
        }
        if (err instanceof InviteEmailMismatchError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'FORBIDDEN', invitedEmail: err.invitedEmail },
          });
        }
        throw err;
      }

      // Land the user in the workspace they just joined, same handoff as
      // organizationSwitch — otherwise they'd accept and stay wherever they
      // were (or nowhere, for a new account).
      const organization = accepted.organization;

      // Tell the workspace it has a new member. Only on an actual join: a
      // re-clicked link that found an existing membership changed nothing,
      // and broadcasting an 'I' for it would claim otherwise. `announceJoin`
      // rather than a bare membership action because the bootstrap scopes
      // `users` to current members — a client already running has never heard
      // of this person, so the membership alone would be inert.
      if (accepted.created) {
        await announceJoin(ctx.prisma, ctx.services.sync, organization.id, accepted.membership);
      }

      ctx.services.auditLog
        .log({
          action: 'member.invite_accepted',
          ipAddress: ctx.clientIp,
          metadata: { role: accepted.role },
          orgId: organization.id,
          resourceId: ctx.userId,
          resourceType: 'OrganizationMember',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      return enterOrganization(ctx, organization);
    },

    organizationInviteCreate: async (
      _parent: unknown,
      { email, role }: { email: string; role: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const actorRole = requireOrgRole(ctx, ['owner', 'admin']);

      let invite: Awaited<ReturnType<typeof ctx.services.organizationInvite.create>>;
      try {
        invite = await ctx.services.organizationInvite.create({
          actorRole,
          email,
          invitedById: ctx.userId,
          orgId: ctx.orgId,
          role,
        });
      } catch (err) {
        rethrowMembershipError(err);
      }

      ctx.services.auditLog
        .log({
          action: 'member.invited',
          ipAddress: ctx.clientIp,
          metadata: { email: invite.email, role: invite.role },
          orgId: ctx.orgId,
          resourceId: invite.id,
          resourceType: 'OrganizationInvite',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      return { invite, success: true };
    },

    organizationInviteRevoke: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      requireOrgRole(ctx, ['owner', 'admin']);

      const revoked = await ctx.services.organizationInvite.revoke(ctx.orgId, id);
      if (!revoked) {
        throw new GraphQLError('This invitation is no longer valid', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      ctx.services.auditLog
        .log({
          action: 'member.invite_revoked',
          ipAddress: ctx.clientIp,
          orgId: ctx.orgId,
          resourceId: id,
          resourceType: 'OrganizationInvite',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      return { success: true };
    },

    /**
     * The caller gives up their own membership in the session's org.
     *
     * Separate from `organizationMemberRemove`, which refuses self-removal on
     * purpose — see `OrganizationService.leaveOrganization`. Deliberately
     * needs no role gate: any member may leave, and the only structural
     * constraint (the last owner cannot) lives in the service, where removal
     * enforces it too.
     *
     * Returns a fresh session rather than just `success`. Leaving invalidates
     * the org the caller is standing in, so the response either moves them
     * into another workspace they hold or hands back an org-less session —
     * which still authenticates well enough to reach `viewerOrganizations`
     * and the create-workspace flow. Without this the client would be left
     * holding a token whose `orgId` names an org it was just ejected from,
     * and every subsequent request would silently drop the claim.
     */
    organizationLeave: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);

      // An impersonated session must not be able to drop the target out of a
      // workspace: the audit trail records the admin entering, not this.
      if (ctx.impersonatorId) {
        throw new GraphQLError('Cannot leave a workspace while impersonating', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      const orgId = ctx.orgId;
      let left: OrganizationMember;
      try {
        left = await ctx.services.organization.leaveOrganization(orgId, ctx.userId);
      } catch (err) {
        rethrowMembershipError(err);
      }

      // Both the role and the org itself are now claims about a membership
      // that no longer exists — see `clearOrgSession` for why they have to go
      // together. `orgId` was captured above, so the rest of this resolver is
      // unaffected.
      clearOrgSession(ctx);

      const sync = await broadcastMembership(ctx.services.sync, orgId, 'D', left);

      ctx.services.auditLog
        .log({
          action: 'member.left',
          ipAddress: ctx.clientIp,
          metadata: { role: left.role },
          orgId,
          resourceId: ctx.userId,
          resourceType: 'OrganizationMember',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      // Re-issue into whichever workspace remains. Resolved *after* the
      // delete, and through the same usable-org filter login uses, so it can
      // neither pick the org just left nor land on a suspended one. Null when
      // nothing remains — an org-less session, not a redirect to a workspace
      // the caller never chose.
      const next = await ctx.services.user.getOrganizationForUser(ctx.userId);
      const tokenPair = await ctx.services.auth.reissueTokens(ctx.userId, next?.id ?? null);
      return {
        accessToken: tokenPair.accessToken,
        expiresIn: tokenPair.expiresIn,
        lastSyncId: sync.id.toString(),
        organization: next ?? null,
        refreshToken: tokenPair.refreshToken,
        success: true,
      };
    },
    organizationMemberRemove: async (
      _parent: unknown,
      { userId }: { userId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const actorRole = requireOrgRole(ctx, ['owner', 'admin']);

      let removed: OrganizationMember;
      try {
        removed = await ctx.services.organization.removeMember(ctx.orgId, userId, {
          role: actorRole,
          userId: ctx.userId,
        });
      } catch (err) {
        rethrowMembershipError(err);
      }

      // The roster is part of the synced dataset, so this lands: every open
      // client drops the row from `organizationMemberStore` and the members
      // list updates without a refetch.
      //
      // Access itself does not depend on it: the removed user's session loses
      // the org on its next request (extractAuthContext re-checks membership)
      // and their WebSocket closes on the next re-auth sweep.
      const sync = await broadcastMembership(ctx.services.sync, ctx.orgId, 'D', removed);

      ctx.services.auditLog
        .log({
          action: 'member.removed',
          ipAddress: ctx.clientIp,
          metadata: { removedRole: removed.role, targetUserId: userId },
          orgId: ctx.orgId,
          resourceId: userId,
          resourceType: 'OrganizationMember',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      return { lastSyncId: sync.id.toString(), success: true };
    },

    organizationMemberUpdateRole: async (
      _parent: unknown,
      { userId, role }: { userId: string; role: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const actorRole = requireOrgRole(ctx, ['owner', 'admin']);

      let updated: OrganizationMember;
      try {
        updated = await ctx.services.organization.updateMemberRole(
          ctx.orgId,
          userId,
          role,
          actorRole,
        );
      } catch (err) {
        rethrowMembershipError(err);
      }

      // Same reasoning as `clearOrgSession` on leave: an admin is allowed to
      // demote themselves to `member`, and every later field in the same
      // document must see that, not the role cached before the mutation ran.
      if (userId === ctx.userId) {
        ctx.orgRole = updated.role;
      }

      const sync = await broadcastMembership(ctx.services.sync, ctx.orgId, 'U', updated);

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

      return enterOrganization(ctx, membership.organization);
    },
  },
  Organization: {
    // Surface the per-org plan-tier caps read-only to any org member. The
    // parent is the Prisma org row (see `Query.organization` / bootstrap),
    // which carries the `max*` columns directly.
    planLimits: (org: Organization) => ({
      maxCustomFieldsPerOrg: org.maxCustomFieldsPerOrg,
      maxCustomFieldsPerTeam: org.maxCustomFieldsPerTeam,
      maxExportRows: org.maxExportRows,
      maxInitiativeDepth: org.maxInitiativeDepth,
      maxLabelGroupChildren: org.maxLabelGroupChildren,
    }),
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

    organizationInvites: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      // Pending invitations expose the email addresses an org has reached out
      // to, so they are admin-only rather than visible to every member.
      requireOrgRole(ctx, ['owner', 'admin']);
      return ctx.services.organizationInvite.listPending(ctx.orgId);
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
