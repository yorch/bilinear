import type { SyncVisibility } from '../lib/sync-visibility';
import { getSyncVisibility } from '../lib/sync-visibility';
import type { GraphQLContext } from './context';

const cache = new WeakMap<object, Promise<SyncVisibility>>();

/**
 * The caller's `SyncVisibility`, resolved once per GraphQL request. Field
 * resolvers that gate by id (Notification.issue, Favorite.entity) run once per
 * row, so without the memo a 50-row list would issue 100 visibility queries.
 * Keyed on the context object, which is rebuilt per request.
 */
export function getRequestVisibility(ctx: GraphQLContext): Promise<SyncVisibility> {
  let pending = cache.get(ctx);
  if (!pending) {
    if (!ctx.userId || !ctx.orgId) {
      // Unauthenticated: nothing is visible beyond what auth already denies.
      return Promise.resolve({ guestTeamIds: [], hiddenTeamIds: [], userId: '' });
    }
    pending = getSyncVisibility(ctx.prisma, ctx.userId, ctx.orgId);
    cache.set(ctx, pending);
  }
  return pending;
}
