import { GraphQLError } from 'graphql';
import type { CustomView } from '../../../generated/prisma';
import { isCustomViewVisible } from '../../lib/entity-visibility';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import {
  type CustomViewCreateInput,
  CustomViewInputError,
  type CustomViewUpdateInput,
} from '../../services/custom-view.service';
import type { GraphQLContext } from '../context';
import { getRequestVisibility } from '../request-visibility';

/** A rejected `filters` payload is the caller's input error, not a 500. */
function badInput(err: unknown): never {
  if (err instanceof CustomViewInputError) {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw err;
}

export const customViewResolvers = {
  CustomView: {
    creator: async (view: CustomView, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.user.findById(view.creatorId),

    team: async (view: CustomView, _args: unknown, ctx: GraphQLContext) => {
      if (!view.teamId) {
        return null;
      }
      return ctx.services.team.findById(view.teamId);
    },
  },

  Mutation: {
    customViewArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.customView.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Custom view not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      if (existing.creatorId !== ctx.userId) {
        throw new GraphQLError('Only the creator can archive this view', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      const customView = await ctx.services.customView.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'CustomView',
        id,
        customView,
      );
      return { customView, lastSyncId: sync.id.toString(), success: true };
    },

    customViewCreate: async (
      _parent: unknown,
      { input }: { input: CustomViewCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      if (input.teamId) {
        const team = await ctx.services.team.findById(input.teamId);
        if (!team || team.organizationId !== ctx.orgId) {
          throw new GraphQLError('Team not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        await requireTeamMember(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);
      }

      const customView = await ctx.services.customView
        .create(ctx.orgId, ctx.userId, input)
        .catch(badInput);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'CustomView',
        customView.id,
        customView,
      );
      return { customView, lastSyncId: sync.id.toString(), success: true };
    },

    customViewDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.customView.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Custom view not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      if (existing.creatorId !== ctx.userId) {
        throw new GraphQLError('Only the creator can delete this view', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      await ctx.services.customView.delete(id);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'CustomView', id, null);
      return { lastSyncId: sync.id.toString(), success: true };
    },

    customViewUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: CustomViewUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.customView.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Custom view not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      if (existing.creatorId !== ctx.userId) {
        throw new GraphQLError('Only the creator can update this view', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      const customView = await ctx.services.customView.update(id, input).catch(badInput);
      // Sharing an unshared view is an INSERT for everyone else: the sync filter
      // never sent them the private copy, so they have nothing to update. The
      // opposite transition stays a `U` — the filter turns it into a delete for
      // everyone but the creator, which evicts the copy they held while shared.
      const becameShared = !existing.shared && customView.shared;
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        becameShared ? 'I' : 'U',
        'CustomView',
        id,
        customView,
      );
      return { customView, lastSyncId: sync.id.toString(), success: true };
    },
  },

  Query: {
    customView: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const customView = await ctx.services.customView.findById(id);
      if (!customView || customView.organizationId !== ctx.orgId) {
        throw new GraphQLError('Custom view not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // Only the creator or shared views are accessible
      if (customView.creatorId !== ctx.userId && !customView.shared) {
        throw new GraphQLError('Custom view not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // Team-scoped views require team membership
      if (customView.teamId) {
        await requireTeamMember(ctx.prisma, customView.teamId, ctx.userId, ctx.orgId);
      }

      return customView;
    },

    customViews: async (_parent: unknown, { teamId }: { teamId?: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      if (teamId) {
        await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
      }

      const views = await ctx.services.customView.findByOrgId(
        ctx.orgId,
        ctx.userId,
        teamId ?? undefined,
      );
      // An org-wide listing must not surface a shared view that lives in a
      // private team the caller is outside of (its name and filters leak).
      const vis = await getRequestVisibility(ctx);
      return views.filter(v => isCustomViewVisible(vis, v));
    },
  },
};
