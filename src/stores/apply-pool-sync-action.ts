/**
 * Apply one incoming SyncAction to a MobX entity pool.
 *
 * `'I'` (insert), `'U'` (update) and `'A'` (archive) are all upserts: an
 * archived row stays resolvable in the pool so back-references still render,
 * and each store's own `all` getter is what filters `archivedAt` out. `'D'`
 * (delete) removes it. A payload-less upsert is ignored rather than writing
 * `null` over a good row — archive/unarchive/snooze/triage broadcasts can
 * arrive without a body.
 *
 * This body was copied verbatim into twelve store methods. It is a free
 * function rather than a base class deliberately: each store keeps its own
 * `action`-annotated method, so `makeObservable` annotations and MobX
 * inheritance semantics are untouched, and a store with extra cascade work
 * (initiative project links, custom-field values) delegates the common half
 * and then does its own. The contract is pinned by `runPoolStoreTests`.
 *
 * Not every dispatcher belongs here: `InitiativeStore.applyInitiativeProjectSyncAction`
 * deliberately omits `'A'`, so it keeps its own body.
 */
export function applyPoolSyncAction<T>(
  pool: Map<string, T>,
  actionType: string,
  id: string,
  data: T | null,
): void {
  if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
    if (data) {
      pool.set(id, data);
    }
  } else if (actionType === 'D') {
    pool.delete(id);
  }
}
