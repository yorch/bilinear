import { GraphQLError } from 'graphql';
import type { SyncAction } from '../../../generated/prisma';

/**
 * Map a service-thrown error (with `name` matching one of the keys in
 * `byCode`) to a `GraphQLError` carrying the matching `extensions.code`.
 * Errors whose name doesn't appear in any bucket are re-thrown unchanged
 * — that way unexpected failures still surface as 500s and aren't
 * silently turned into 400s.
 *
 * Usage:
 *   try {
 *     return await service.doThing(...);
 *   } catch (err) {
 *     mapServiceError(err, {
 *       NOT_FOUND: ['ThingNotFoundError'],
 *       BAD_USER_INPUT: ['ThingInvalidInputError'],
 *     });
 *   }
 *
 * Each new resolver was hand-rolling a near-identical `switch (err.name)`
 * block; this collapses them to a small lookup table.
 */
export function mapServiceError(err: unknown, byCode: Record<string, readonly string[]>): never {
  const name = (err as { name?: string }).name;
  const message = (err as { message?: string }).message ?? 'Internal error';
  if (name) {
    for (const [code, names] of Object.entries(byCode)) {
      if (names.includes(name)) {
        throw new GraphQLError(message, { extensions: { code } });
      }
    }
  }
  throw err;
}

/**
 * Standard `{ success, lastSyncId, ...entity }` mutation result envelope.
 *
 * Every mutation that creates a SyncAction (i.e. ~all of them) shapes its
 * return value the same way. This collapses the boilerplate so resolvers
 * don't manually `String(sync.id)`-stringify and assemble the object.
 *
 * Pass the SyncAction returned by `ctx.services.sync.createSyncAction(...)`
 * along with the entity payload — e.g. `withSyncResult(sync, { issue })`.
 */
export function withSyncResult<T extends Record<string, unknown>>(
  sync: SyncAction,
  payload: T,
): T & { success: true; lastSyncId: string } {
  return { ...payload, lastSyncId: sync.id.toString(), success: true };
}
