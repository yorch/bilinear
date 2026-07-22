import { GraphQLError } from 'graphql';
import type { Team, TeamMembership } from '../../../generated/prisma';
import { childLogger } from '../../lib/logger';
import {
  isTeamGuest,
  requireAuth,
  requireOrgRole,
  requireTeamMember,
  requireTeamMemberNotGuest,
  requireTeamOwner,
} from '../../middleware/auth';
import type {
  TeamCreateInput,
  TeamDeleteInput,
  TeamUpdateInput,
} from '../../services/team.service';
import type { GraphQLContext } from '../context';

const log = childLogger({ module: 'resolver/team' });

async function isOrgAdmin(
  prisma: GraphQLContext['prisma'],
  orgId: string,
  userId: string,
): Promise<boolean> {
  const membership = await prisma.organizationMember.findUnique({
    select: { role: true },
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  return membership?.role === 'admin' || membership?.role === 'owner';
}

export const teamResolvers = {
  Mutation: {
    teamCreate: async (
      _parent: unknown,
      { input }: { input: TeamCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);

      try {
        const result = await ctx.services.team.create(ctx.orgId, ctx.userId, input);

        // Emit sync actions for the workflow states so clients receive them
        for (const state of result.states) {
          await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'I',
            'WorkflowState',
            state.id,
            state,
          );
        }

        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'Team',
          result.team.id,
          result.team,
        );
        // Fire-and-forget audit log — errors are non-fatal
        ctx.services.auditLog
          .log({
            action: 'team.created',
            ipAddress: ctx.clientIp,
            metadata: { key: input.key, name: input.name },
            orgId: ctx.orgId,
            resourceId: result.team.id,
            resourceType: 'Team',
            userId: ctx.userId,
          })
          .catch(err => log.warn({ err }, 'audit log failed'));
        return {
          lastSyncId: sync.id.toString(),
          success: true,
          team: result.team,
        };
      } catch (err) {
        const error = err as Error & { code?: string };
        if (error.name === 'TeamKeyInvalidError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        if (error.code === 'P2002') {
          throw new GraphQLError('A team with this key already exists in the organization', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    teamDelete: async (
      _parent: unknown,
      { id, input }: { id: string; input: TeamDeleteInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);

      const team = await ctx.services.team.findById(id);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // Validate target team belongs to the same org
      if (input.moveToTeamId) {
        const targetTeam = await ctx.services.team.findById(input.moveToTeamId);
        if (!targetTeam || targetTeam.organizationId !== ctx.orgId) {
          throw new GraphQLError('Target team not found', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
      }

      try {
        const result = await ctx.services.team.delete(id, input);

        // Create sync actions for moved issues
        for (const issue of result.movedIssues) {
          await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Issue', issue.id, issue);
        }

        const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Team', id, null);
        // Fire-and-forget audit log — errors are non-fatal
        ctx.services.auditLog
          .log({
            action: 'team.deleted',
            ipAddress: ctx.clientIp,
            orgId: ctx.orgId,
            resourceId: id,
            resourceType: 'Team',
            userId: ctx.userId,
          })
          .catch(err => log.warn({ err }, 'audit log failed'));
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        const error = err as Error;
        if (
          error.name === 'TeamDeleteMoveTargetRequiredError' ||
          error.name === 'TeamDeleteMoveToSelfError' ||
          error.name === 'TeamDeleteMoveNoStatesError' ||
          error.name === 'TeamNotFoundError'
        ) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    teamUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: TeamUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.team.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // A plain requireTeamMember let ANY team member — including guests —
      // rename the team or flip triage/cycle settings. Require org
      // admin/owner (same bar as teamCreate/teamDelete), or a non-guest
      // team owner.
      if (!(await isOrgAdmin(ctx.prisma, ctx.orgId, ctx.userId))) {
        await requireTeamOwner(ctx.prisma, id, ctx.userId, ctx.orgId);
        await requireTeamMemberNotGuest(ctx.prisma, id, ctx.userId, ctx.orgId);
      }

      const team = await ctx.services.team.update(id, input);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Team', id, team);
      return { lastSyncId: sync.id.toString(), success: true, team };
    },
  },

  Query: {
    team: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const team = await ctx.services.team.findById(id);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      if (team.private && !(await isOrgAdmin(ctx.prisma, ctx.orgId, ctx.userId))) {
        const isMember = await ctx.services.team.isTeamMember(id, ctx.userId);
        if (!isMember) {
          throw new GraphQLError('Team not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }
      }
      return team;
    },

    teams: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const allTeams = await ctx.services.team.findByOrgId(ctx.orgId);

      if (await isOrgAdmin(ctx.prisma, ctx.orgId, ctx.userId)) {
        return allTeams;
      }

      // Non-admins: filter out private teams they're not members of
      const memberTeamIds = await ctx.services.team.findMemberTeamIds(
        allTeams.map(t => t.id),
        ctx.userId,
      );

      return allTeams.filter(t => !t.private || memberTeamIds.has(t.id));
    },
  },

  Team: {
    children: async (team: Team, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.team.findChildren(team.id),

    issues: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, team.id, ctx.userId, ctx.orgId);
      // Guest visibility + snooze-hide: findByTeamId used to return every
      // non-archived, non-trashed issue on the team with no guest scoping
      // or snooze filter at all — a backdoor around the guarded top-level
      // `issues` query. Mirror Cycle.issues/Project.issues/Issue.children.
      const guest = await isTeamGuest(ctx.prisma, team.id, ctx.userId, ctx.orgId);
      return ctx.services.issue.findByTeamId(team.id, false, guest ? ctx.userId : undefined);
    },

    members: async (team: Team, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.team.getMembers(team.id),

    organization: async (team: Team, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.organization.findById(team.organizationId),

    parent: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      if (!team.parentId) {
        return null;
      }
      return ctx.services.team.findById(team.parentId);
    },

    states: async (team: Team, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.workflowState.findByTeamId(team.id),
  },

  TeamMembership: {
    owner: (membership: TeamMembership) => membership.isOwner,
    role: async (membership: TeamMembership, _args: unknown, ctx: GraphQLContext) => {
      const tmr = await ctx.prisma.teamMemberRole.findUnique({
        select: { role: true },
        where: {
          teamId_userId: {
            teamId: membership.teamId,
            userId: membership.userId,
          },
        },
      });
      return tmr?.role ?? 'member';
    },

    team: async (membership: TeamMembership, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.team.findById(membership.teamId),

    user: async (membership: TeamMembership, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.user.findById(membership.userId),
  },
};
