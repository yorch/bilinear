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
 * This body was copied verbatim into seventeen store methods across fifteen
 * stores. It is a free function rather than a base class deliberately: each
 * store keeps its own `action`-annotated method, so `makeObservable` annotations
 * and MobX inheritance semantics are untouched, and a store with extra cascade
 * work (initiative project links, custom-field values) delegates the common half
 * and then does its own. Each store keeps whatever comment explains what archive
 * means for *its* entity, since that reasoning is per-entity, not shared.
 *
 * The contract is pinned in three places: `runPoolStoreTests` for the stores
 * that run it, `apply-pool-sync-action.test.ts` for the branches no store
 * exercises directly (a payload-less upsert, an unrecognised verb), and
 * `project-store.test.ts` for the one store with three pools, where the risk is
 * a dispatcher wired to the wrong one.
 *
 * One dispatcher deliberately does NOT belong here:
 * `InitiativeStore.applyInitiativeProjectSyncAction` omits `'A'`, so routing it
 * through this helper would change behavior.
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
