import { GraphQLError } from 'graphql';
import type { Initiative, InitiativeUpdate } from '../../../generated/prisma';
import { logger } from '../../lib/logger';
import { requireAuth } from '../../middleware/auth';
import type {
  InitiativeCreateInput,
  InitiativeUpdateInput,
} from '../../services/initiative.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const INITIATIVE_ERROR_MAP = {
  BAD_USER_INPUT: [
    'InitiativeInvalidStatusError',
    'InitiativeProjectNotFoundError',
    'InitiativeInvalidParentError',
    'InitiativeMaxDepthError',
    'InitiativeValidationError',
  ],
  NOT_FOUND: ['InitiativeNotFoundError'],
} as const;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const initiativeResolvers = {
  Initiative: {
    children: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.loaders.childrenByInitiativeId.load(initiative.id);
    },

    creator: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) =>
      initiative.creatorId ? ctx.loaders.user.load(initiative.creatorId) : null,

    health: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) => {
      // Reuses the same batched updates loader as the `updates` field
      // (they share the identical archivedAt:null / createdAt-desc query)
      // instead of a second per-initiative findFirst. The loader's array
      // is already ordered newest-first, so its head is the latest update;
      // if that one falls outside the 30-day window, none do (everything
      // else is older still), matching the original findFirst's filter.
      const since = Date.now() - THIRTY_DAYS_MS;
      const updates = await ctx.loaders.updatesByInitiativeId.load(initiative.id);
      const latest = updates[0];
      if (latest && latest.createdAt.getTime() >= since) {
        return latest.health;
      }
      // Fall back to a progress-based heuristic when no recent update exists.
      const p = initiative.progress;
      if (p >= 0.67) {
        return 'onTrack';
      }
      if (p >= 0.33) {
        return 'atRisk';
      }
      if (p > 0) {
        return 'offTrack';
      }
      return 'unknown';
    },

    owner: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) =>
      initiative.ownerId ? ctx.loaders.user.load(initiative.ownerId) : null,

    parent: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return initiative.parentId
        ? ctx.services.initiative.findById(ctx.orgId, initiative.parentId)
        : null;
    },

    projects: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) => {
      // Use the project DataLoader so the full Project row flows through
      // (callers asking for `slugId`, `color`, `statusType`, etc. get the
      // real values). Filter out projects from a different org or that
      // were archived between link creation and this read.
      const ids = await ctx.services.initiative.getProjectIds(initiative.id);
      const projects = await Promise.all(ids.map(id => ctx.loaders.project.load(id)));
      return projects.filter(
        (p): p is NonNullable<typeof p> =>
          p !== null && p.organizationId === ctx.orgId && !p.archivedAt && !p.trashed,
      );
    },

    updates: async (initiative: Initiative, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.updatesByInitiativeId.load(initiative.id),
  },

  InitiativeUpdate: {
    user: async (update: InitiativeUpdate, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.user.load(update.userId),
  },

  Mutation: {
    initiativeAddProject: async (
      _parent: unknown,
      { initiativeId, projectId }: { initiativeId: string; projectId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      try {
        const link = await ctx.services.initiative.addProject(ctx.orgId, initiativeId, projectId);
        // Cascade so ancestor initiatives also get their progress
        // recomputed AND broadcast — without this, parent rollups drift
        // on connected clients until next bootstrap.
        const { self, ancestors } =
          await ctx.services.initiative.recomputeProgressCascade(initiativeId);
        await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'InitiativeProject',
          link.id,
          link,
        );
        const recomputed = [self, ...ancestors].filter(
          (i): i is NonNullable<typeof i> => i !== null,
        );
        // If recompute produced no rows (no-op skip), fall back to a
        // findById so the resolver still returns the current state.
        const primary =
          recomputed.find(r => r.id === initiativeId) ??
          (await ctx.services.initiative.findById(ctx.orgId, initiativeId));
        let sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Initiative',
          initiativeId,
          primary,
        );
        // One SyncAction per ancestor whose progress actually moved.
        for (const ancestor of recomputed.filter(r => r.id !== initiativeId)) {
          sync = await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'U',
            'Initiative',
            ancestor.id,
            ancestor,
          );
        }
        if (primary) {
          void ctx.services.webhook
            .dispatchEvent(ctx.orgId, 'initiative.updated', primary)
            .catch(err => logger.error({ err }, 'webhook dispatch failed: initiative.updated'));
        }
        return { initiative: primary, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, INITIATIVE_ERROR_MAP);
      }
    },

    initiativeArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      try {
        const initiative = await ctx.services.initiative.archive(ctx.orgId, id);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'A',
          'Initiative',
          id,
          initiative,
        );
        return { initiative, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, INITIATIVE_ERROR_MAP);
      }
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
          .catch(err => logger.error({ err }, 'webhook dispatch failed: initiative.created'));
        return { initiative, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, INITIATIVE_ERROR_MAP);
      }
    },

    initiativeDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      try {
        await ctx.services.initiative.delete(ctx.orgId, id);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'D',
          'Initiative',
          id,
          null,
        );
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, INITIATIVE_ERROR_MAP);
      }
    },

    initiativeRemoveProject: async (
      _parent: unknown,
      { initiativeId, projectId }: { initiativeId: string; projectId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const initiative = await ctx.services.initiative.findById(ctx.orgId, initiativeId);
      if (!initiative) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const removedId = await ctx.services.initiative.removeProject(initiativeId, projectId);
      const { self, ancestors } =
        await ctx.services.initiative.recomputeProgressCascade(initiativeId);
      if (removedId) {
        await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'D',
          'InitiativeProject',
          removedId,
          null,
        );
      }
      const recomputed = [self, ...ancestors].filter((i): i is NonNullable<typeof i> => i !== null);
      const primary =
        recomputed.find(r => r.id === initiativeId) ??
        (await ctx.services.initiative.findById(ctx.orgId, initiativeId));
      let sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Initiative',
        initiativeId,
        primary,
      );
      for (const ancestor of recomputed.filter(r => r.id !== initiativeId)) {
        sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Initiative',
          ancestor.id,
          ancestor,
        );
      }
      if (primary) {
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'initiative.updated', primary)
          .catch(err => logger.error({ err }, 'webhook dispatch failed: initiative.updated'));
      }
      return { initiative: primary, lastSyncId: sync.id.toString(), success: true };
    },

    initiativeUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: InitiativeUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      try {
        const initiative = await ctx.services.initiative.update(ctx.orgId, id, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Initiative',
          id,
          initiative,
        );
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'initiative.updated', initiative)
          .catch(err => logger.error({ err }, 'webhook dispatch failed: initiative.updated'));
        return { initiative, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, INITIATIVE_ERROR_MAP);
      }
    },

    initiativeUpdateCreate: async (
      _parent: unknown,
      {
        input,
      }: {
        input: {
          id?: string;
          initiativeId: string;
          body: string;
          bodyData: Record<string, unknown>;
          health: string;
        };
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const initiative = await ctx.services.initiative.findById(ctx.orgId, input.initiativeId);
      if (!initiative) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const update = await ctx.services.initiative.createInitiativeUpdate({
        ...input,
        userId: ctx.userId,
      });
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'InitiativeUpdate',
        update.id,
        update,
      );
      return {
        initiativeUpdate: update,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },

    initiativeUpdateDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.initiative.findInitiativeUpdateById(id);
      if (!existing) {
        throw new GraphQLError('Update not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const initiative = await ctx.services.initiative.findById(ctx.orgId, existing.initiativeId);
      if (!initiative) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      if (existing.userId !== ctx.userId) {
        throw new GraphQLError('Only the author can delete this update', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      await ctx.services.initiative.deleteInitiativeUpdate(id);
      // Soft-delete (archivedAt is stamped server-side); client stores treat
      // this as a removal from the timeline, matching the ProjectUpdate
      // delete convention rather than the 'A' archive sync action which
      // requires a payload to flip the cached row.
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'InitiativeUpdate',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },

    initiativeUpdateUpdate: async (
      _parent: unknown,
      {
        id,
        input,
      }: {
        id: string;
        input: { body?: string; bodyData?: Record<string, unknown>; health?: string };
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.initiative.findInitiativeUpdateById(id);
      if (!existing) {
        throw new GraphQLError('Update not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const initiative = await ctx.services.initiative.findById(ctx.orgId, existing.initiativeId);
      if (!initiative) {
        throw new GraphQLError('Initiative not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      if (existing.userId !== ctx.userId) {
        throw new GraphQLError('Only the author can edit this update', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      const update = await ctx.services.initiative.updateInitiativeUpdate(id, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'InitiativeUpdate',
        id,
        update,
      );
      return {
        initiativeUpdate: update,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },
  },

  Query: {
    initiative: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const initiative = await ctx.services.initiative.findById(ctx.orgId, id);
      if (!initiative) {
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
