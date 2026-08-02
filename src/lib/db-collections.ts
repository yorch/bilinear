/**
 * Which collections a complete warm cache holds, and how to check a cache's
 * claim to hold them.
 *
 * Deliberately separate from `db.ts`: this is pure data plus one predicate,
 * with no Dexie import. `db.ts` constructs an `AppDatabase` at module scope,
 * so anything importing it drags IndexedDB into scope — including tests that
 * mock `./db` wholesale and would otherwise see these exports as `undefined`.
 */

/**
 * The collections `SyncManager.fullBootstrap` clears and refills in one
 * transaction — i.e. exactly what a complete cache contains.
 *
 * This exists because "is there a cache?" and "is the cache complete?" are
 * different questions, and only the first was being asked. `loadFromIndexedDB`
 * returned true on the presence of a `lastSyncId`, so a Dexie upgrade that
 * *adds* a collection would leave that one table empty, still report a usable
 * cache, and take the delta path — which only carries rows that changed. An
 * untouched collection would never backfill and whatever reads it would render
 * an empty state indefinitely.
 *
 * So `fullBootstrap` stamps this set into `syncMetadata` alongside the rows it
 * describes, and `loadFromIndexedDB` refuses a cache whose stamp doesn't cover
 * every name here. Adding a collection to bootstrap therefore costs exactly one
 * edit — add it below — and every existing client re-bootstraps once instead of
 * silently running with a hole.
 *
 * `favorites` is deliberately **absent**. It is delta-only: the server's
 * bootstrap payload doesn't carry favorites, `fullBootstrap` doesn't write
 * them, and the sidebar reads them straight from GraphQL (`FAVORITES_QUERY`),
 * using the store purely as a refetch trigger. Listing it here would make every
 * client re-bootstrap forever, since bootstrap could never satisfy it.
 *
 * `pendingTransactions` and `syncMetadata` are absent for the same kind of
 * reason — neither is server-replicated state, and bootstrap must not clear
 * the offline queue.
 */
export const CACHED_COLLECTIONS = [
  'customFieldDefinitions',
  'customFieldValues',
  'customViews',
  'cycles',
  'documents',
  'initiativeProjects',
  'initiatives',
  'issueLabels',
  'issueRelations',
  'issueTemplates',
  'issues',
  'notifications',
  'organizationMembers',
  'organizations',
  'projectMilestones',
  'projectUpdates',
  'projects',
  'teams',
  'users',
  'workflowStates',
] as const;

/** `syncMetadata` key holding the collection set a cache was built from. */
export const COLLECTIONS_STAMP_KEY = 'cachedCollections';

/**
 * True when `stamp` covers every collection this build requires.
 *
 * Extra names are fine — a cache written by a *newer* build that has since been
 * rolled back still contains everything an older build needs, so forcing a
 * re-bootstrap there would be pure cost. Missing names are not fine: that is
 * precisely the hole this check exists to catch.
 */
export function stampCoversRequiredCollections(stamp: unknown): boolean {
  if (!Array.isArray(stamp)) {
    return false;
  }
  const present = new Set(stamp.filter((name): name is string => typeof name === 'string'));
  return CACHED_COLLECTIONS.every(name => present.has(name));
}
