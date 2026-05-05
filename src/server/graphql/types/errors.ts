import { GraphQLError } from 'graphql';

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
