import { GraphQLError } from 'graphql';
import type { Initiative } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type {
  InitiativeCreateInput,
  InitiativeUpdateInput,
} from '../../services/initiative.service';
import type { GraphQLContext } from '../context';

function mapInitiativeError(err: unknown): never {
  const error = err as Error;
  switch (error.name) {
    case 'InitiativeNotFoundError':
      throw new GraphQLError(error.message, {
        extensions: { code: 'NOT_FOUND' },
      });
    case 'InitiativeInvalidStatusError':
    case 'InitiativeProjectNotFoundError':
      throw new GraphQLError(error.message, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    default:
      throw err;
  }
}

export const initiativeResolvers = {
  Initiative: {
    creator: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) =>
      initiative.creatorId ? ctx.loaders.user.load(initiative.creatorId) : null,

    owner: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) =>
      initiative.ownerId ? ctx.loaders.user.load(initiative.ownerId) : null,

    projects: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) => {
      const links = await ctx.services.initiative.getProjects(initiative.id);
      return links.map(l => l.project);
    },
  },

  Mutation: {
    initiativeAddProject: async (
      _parent: unknown,
      { initiativeId, projectId }: { initiativeId: string; projectId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const initiative = await ctx.services.initiative.findById(initiativeId);
      if (!initiative || initiative.organizationId !== ctx.orgId) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const project = await ctx.services.project.findById(projectId);
      if (!project || project.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const link = await ctx.services.initiative.addProject(initiativeId, projectId);
      const updated = await ctx.services.initiative.findById(initiativeId);
      // Emit both an InitiativeProject 'I' (so other clients populate the
      // project link map) and an Initiative 'U' (so the recomputed
      // progress propagates).
      await ctx.services.sync.createSyncAction(ctx.orgId, 'I', 'InitiativeProject', link.id, link);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Initiative',
        initiativeId,
        updated,
      );
      return { initiative: updated, lastSyncId: sync.id.toString(), success: true };
    },

    initiativeArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.initiative.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const initiative = await ctx.services.initiative.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'Initiative',
        id,
        initiative,
      );
      return { initiative, lastSyncId: sync.id.toString(), success: true };
    },

    initiativeCreate: async (
      _parent: unknown,
      { input }: { input: InitiativeCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      try {
        const initiative = await ctx.services.initiative.create(ctx.orgId, ctx.userId, input);
        let sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'Initiative',
          initiative.id,
          initiative,
        );
        // If the create input linked projects, fan out InitiativeProject
        // 'I' actions for each — without this, other clients see the
        // initiative but no associated projects until bootstrap.
        if (input.projectIds?.length) {
          const links = await ctx.services.initiative.getProjects(initiative.id);
          for (const link of links) {
            sync = await ctx.services.sync.createSyncAction(
              ctx.orgId,
              'I',
              'InitiativeProject',
              link.id,
              {
                createdAt: link.createdAt,
                id: link.id,
                initiativeId: link.initiativeId,
                projectId: link.projectId,
                sortOrder: link.sortOrder,
              },
            );
          }
        }
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'initiative.created', initiative)
          .catch(() => {});
        return { initiative, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapInitiativeError(err);
      }
    },

    initiativeDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.initiative.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.initiative.delete(id);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Initiative', id, null);
      return { lastSyncId: sync.id.toString(), success: true };
    },

    initiativeRemoveProject: async (
      _parent: unknown,
      { initiativeId, projectId }: { initiativeId: string; projectId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const initiative = await ctx.services.initiative.findById(initiativeId);
      if (!initiative || initiative.organizationId !== ctx.orgId) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const removedId = await ctx.services.initiative.removeProject(initiativeId, projectId);
      const updated = await ctx.services.initiative.findById(initiativeId);
      // Emit a 'D' for the link row (so other clients drop it from their
      // store) and a 'U' for the initiative (recomputed progress).
      if (removedId) {
        await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'D',
          'InitiativeProject',
          removedId,
          null,
        );
      }
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Initiative',
        initiativeId,
        updated,
      );
      return { initiative: updated, lastSyncId: sync.id.toString(), success: true };
    },

    initiativeUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: InitiativeUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.initiative.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      try {
        const initiative = await ctx.services.initiative.update(id, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Initiative',
          id,
          initiative,
        );
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'initiative.updated', initiative)
          .catch(() => {});
        return { initiative, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapInitiativeError(err);
      }
    },
  },

  Query: {
    initiative: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const initiative = await ctx.services.initiative.findById(id);
      if (!initiative || initiative.organizationId !== ctx.orgId) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return initiative;
    },

    initiatives: async (
      _parent: unknown,
      { includeArchived }: { includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.initiative.findByOrgId(ctx.orgId, includeArchived ?? false);
    },
  },
};
