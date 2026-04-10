import { GraphQLError } from 'graphql';
import type { CustomView } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type {
  CustomViewCreateInput,
  CustomViewUpdateInput,
} from '../../services/custom-view.service';
import type { GraphQLContext } from '../context';

export const customViewResolvers = {
  CustomView: {
    creator: async (view: CustomView, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.user.findById(view.creatorId);
    },

    team: async (view: CustomView, _args: unknown, ctx: GraphQLContext) => {
      if (!view.teamId) {
        return null;
      }
      return ctx.services.team.findById(view.teamId);
    },
  },

  Mutation: {
    customViewArchive: async (
      _parent: unknown,
      { id }: { id: string },
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
      }

      const customView = await ctx.services.customView.create(
        ctx.orgId,
        ctx.userId,
        input,
      );
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'CustomView',
        customView.id,
        customView,
      );
      return { customView, lastSyncId: sync.id.toString(), success: true };
    },

    customViewDelete: async (
      _parent: unknown,
      { id }: { id: string },
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
        throw new GraphQLError('Only the creator can delete this view', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      await ctx.services.customView.delete(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'CustomView',
        id,
        null,
      );
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

      const customView = await ctx.services.customView.update(id, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'CustomView',
        id,
        customView,
      );
      return { customView, lastSyncId: sync.id.toString(), success: true };
    },
  },

  Query: {
    customView: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
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

      return customView;
    },

    customViews: async (
      _parent: unknown,
      { teamId }: { teamId?: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      return ctx.services.customView.findByOrgId(
        ctx.orgId,
        ctx.userId,
        teamId ?? undefined,
      );
    },
  },
};
