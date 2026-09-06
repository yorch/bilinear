import { GraphQLError } from 'graphql';
import type { Favorite } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import {
  entityBelongsToOrg,
  type FavoriteCreateInput,
  type FavoriteReorderEntry,
} from '../../services/favorite.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const FAVORITE_ERRORS = {
  BAD_USER_INPUT: [
    'FavoriteCrossOrgConflictError',
    'FavoriteEntityNotInOrgError',
    'FavoriteInvalidEntityTypeError',
    'FavoriteReorderTooLargeError',
  ],
  NOT_FOUND: ['FavoriteNotFoundError'],
} as const;

/**
 * Resolve the favorite's target entity to the matching union member. Returns
 * null when the row was deleted or moved to a different org (the caller's
 * Favorite row carries a dangling `entityId`); the sidebar component skips
 * null entries silently rather than 404ing.
 *
 * Batched per entity type via the per-request DataLoaders — a `favorites`
 * list of N rows fires at most one `IN (...)` query per distinct
 * `entityType` present (GraphQL resolves each row's `entity` field
 * concurrently, so DataLoader coalesces the `.load()` calls within the
 * tick), instead of one query per favorite. Cross-org/deleted → null
 * behavior is unchanged — same per-row check against `ctx.orgId`, just
 * against a batch-fetched row instead of a per-row query.
 */
async function resolveEntity(
  fav: Favorite,
  ctx: GraphQLContext,
): Promise<{ __typename: string; id: string } | null> {
  const orgId = ctx.orgId;
  if (!orgId) {
    return null;
  }
  switch (fav.entityType) {
    case 'Issue': {
      const issue = await ctx.loaders.issueById.load(fav.entityId);
      if (!issue || issue.organizationId !== orgId) {
        return null;
      }
      return { ...issue, __typename: 'Issue' };
    }
    case 'Project': {
      const project = await ctx.loaders.project.load(fav.entityId);
      if (!project || project.organizationId !== orgId) {
        return null;
      }
      return { ...project, __typename: 'Project' };
    }
    case 'Initiative': {
      // initiativeById is already org-scoped in its batch query (mirrors
      // InitiativeService.findById(orgId, id)), so no extra org check here
      // — matches the pre-batching behavior exactly.
      const initiative = await ctx.loaders.initiativeById.load(fav.entityId);
      return initiative ? { ...initiative, __typename: 'Initiative' } : null;
    }
    case 'CustomView': {
      const view = await ctx.loaders.customViewById.load(fav.entityId);
      if (!view || view.organizationId !== orgId) {
        return null;
      }
      return { ...view, __typename: 'CustomView' };
    }
    case 'Cycle': {
      const cycle = await ctx.loaders.cycle.load(fav.entityId);
      if (!cycle || cycle.organizationId !== orgId) {
        return null;
      }
      return { ...cycle, __typename: 'Cycle' };
    }
    case 'Document': {
      const doc = await ctx.loaders.documentById.load(fav.entityId);
      if (!doc || doc.organizationId !== orgId) {
        return null;
      }
      return { ...doc, __typename: 'Document' };
    }
    case 'Team': {
      const team = await ctx.loaders.team.load(fav.entityId);
      if (!team || team.organizationId !== orgId) {
        return null;
      }
      return { ...team, __typename: 'Team' };
    }
    default:
      return null;
  }
}

export const favoriteResolvers = {
  Favorite: {
    entity: (fav: Favorite, _args: unknown, ctx: GraphQLContext) => resolveEntity(fav, ctx),
  },
  Mutation: {
    favoriteCreate: async (
      _parent: unknown,
      { input }: { input: FavoriteCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      // Validate the entity exists in the caller's org BEFORE persisting.
      // Without this, a client could favorite any UUID (cross-org probe
      // for valid ids, or just pollute the SyncAction stream with
      // entities that resolve to null on every other client).
      const exists = await entityBelongsToOrg(
        ctx.prisma,
        input.entityType,
        input.entityId,
        ctx.orgId,
      );
      if (!exists) {
        throw new GraphQLError('Entity not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      try {
        const fav = await ctx.services.favorite.create(ctx.orgId, ctx.userId, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'Favorite',
          fav.id,
          fav,
        );
        return { favorite: fav, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, FAVORITE_ERRORS);
      }
    },
    favoriteDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      try {
        await ctx.services.favorite.delete(ctx.orgId, ctx.userId, id);
        const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Favorite', id, null);
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, FAVORITE_ERRORS);
      }
    },
    favoriteReorder: async (
      _parent: unknown,
      { entries }: { entries: FavoriteReorderEntry[] },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        const favs = await ctx.services.favorite.reorder(ctx.orgId, ctx.userId, entries);
        // Emit one 'U' per row sequentially so the returned `lastSyncId`
        // is genuinely the highest id. Promise.all here lets sync_actions
        // commit in an order that diverges from the favs array, and
        // taking `lastSync[length-1]` would return a non-max watermark.
        let lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
        for (const f of favs) {
          const sync = await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'U',
            'Favorite',
            f.id,
            f,
          );
          lastSyncId = sync.id.toString();
        }
        return { favorites: favs, lastSyncId, success: true };
      } catch (err) {
        mapServiceError(err, FAVORITE_ERRORS);
      }
    },
  },
  Query: {
    favorites: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.favorite.findByUser(ctx.orgId, ctx.userId);
    },
  },
};
