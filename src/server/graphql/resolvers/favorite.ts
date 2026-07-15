import { GraphQLError } from 'graphql';
import type { Favorite } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import {
  type FavoriteCreateInput,
  FavoriteCrossOrgConflictError,
  FavoriteEntityNotInOrgError,
  FavoriteInvalidEntityTypeError,
  FavoriteNotFoundError,
  type FavoriteReorderEntry,
  FavoriteReorderTooLargeError,
} from '../../services/favorite.service';
import type { GraphQLContext } from '../context';

/**
 * Confirm an entityId belongs to a row of the right type AND to ctx.orgId
 * before allowing it to be favorited. Mirrors `resolveEntity` minus the
 * union-return wrapping — keeping the two in lockstep avoids the case
 * where a new favoritable type is added to one but not the other.
 */
async function entityBelongsToOrg(
  entityType: string,
  entityId: string,
  ctx: GraphQLContext,
): Promise<boolean> {
  const orgId = ctx.orgId;
  if (!orgId) {
    return false;
  }
  switch (entityType) {
    case 'Issue': {
      const issue = await ctx.services.issue.findById(entityId);
      return !!issue && issue.organizationId === orgId;
    }
    case 'Project': {
      const project = await ctx.loaders.project.load(entityId);
      return !!project && project.organizationId === orgId;
    }
    case 'Initiative': {
      const initiative = await ctx.services.initiative.findById(orgId, entityId);
      return !!initiative;
    }
    case 'CustomView': {
      const view = await ctx.services.customView.findById(entityId);
      return !!view && view.organizationId === orgId;
    }
    case 'Cycle': {
      const cycle = await ctx.loaders.cycle.load(entityId);
      return !!cycle && cycle.organizationId === orgId;
    }
    case 'Document': {
      const doc = await ctx.services.document.findById(entityId);
      return !!doc && doc.organizationId === orgId;
    }
    case 'Team': {
      const team = await ctx.loaders.team.load(entityId);
      return !!team && team.organizationId === orgId;
    }
    default:
      return false;
  }
}

function mapError(err: unknown): never {
  if (err instanceof FavoriteNotFoundError) {
    throw new GraphQLError(err.message, {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  if (err instanceof FavoriteInvalidEntityTypeError) {
    throw new GraphQLError(err.message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  if (err instanceof FavoriteEntityNotInOrgError) {
    throw new GraphQLError(err.message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  if (err instanceof FavoriteCrossOrgConflictError) {
    throw new GraphQLError(err.message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  if (err instanceof FavoriteReorderTooLargeError) {
    throw new GraphQLError(err.message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  throw err;
}

/**
 * Resolve the favorite's target entity to the matching union member. Returns
 * null when the row was deleted or moved to a different org (the caller's
 * Favorite row carries a dangling `entityId`); the sidebar component skips
 * null entries silently rather than 404ing. Best-effort: no batching here
 * because the typical user has <50 favorites and entity types are mixed.
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
      const issue = await ctx.services.issue.findById(fav.entityId);
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
      const initiative = await ctx.services.initiative.findById(orgId, fav.entityId);
      return initiative ? { ...initiative, __typename: 'Initiative' } : null;
    }
    case 'CustomView': {
      const view = await ctx.services.customView.findById(fav.entityId);
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
      const doc = await ctx.services.document.findById(fav.entityId);
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
      const exists = await entityBelongsToOrg(input.entityType, input.entityId, ctx);
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
        mapError(err);
      }
    },
    favoriteDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      try {
        await ctx.services.favorite.delete(ctx.orgId, ctx.userId, id);
        const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Favorite', id, null);
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapError(err);
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
        mapError(err);
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
