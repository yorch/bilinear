import { describe, expect, it } from 'vitest';

/**
 * Minimal shape every MobX pool store implements: a `pool` Map keyed by id,
 * plus the `applySyncAction('I' | 'U' | 'D' | 'A', id, data)` handler that
 * the sync-manager drives off incoming SyncActions.
 */
export interface PoolStoreLike<T> {
  applySyncAction(actionType: string, id: string, data: T | null): void;
  pool: Map<string, T>;
}

export interface RunPoolStoreTestsOptions<T extends { id: string }> {
  /**
   * Whether this store's `applySyncAction('A', ...)` behaves like an
   * in-place upsert (same as 'I'/'U' — the row stays in `pool` with the new
   * data). All current pool stores do this ('A' rows stay resolvable for
   * back-references; callers filter archived rows out of `all` themselves).
   * Set to false for a store that instead removes the row on 'A'.
   */
  archiveIsUpsert?: boolean;
  /** Builds a minimal valid row, honoring any overrides (id included). */
  makeRow: (overrides: Partial<T> & { id: string }) => T;
  /** Fresh store instance per test. */
  makeStore: () => PoolStoreLike<T>;
  /**
   * A scalar field (present on every row) safe to use for asserting that
   * 'U'/'A' actually apply the new data rather than being no-ops.
   */
  updateField: keyof T;
  /** The value `updateField` is set to for the update/archive assertions. */
  updateValue: T[keyof T];
}

/**
 * Shared applySyncAction contract tests for a MobX pool store. Call this
 * inside a store's own `describe()` block; it adds its own nested
 * `describe('applySyncAction', ...)`.
 */
export function runPoolStoreTests<T extends { id: string }>(options: RunPoolStoreTestsOptions<T>) {
  const { makeStore, makeRow, updateField, updateValue, archiveIsUpsert = true } = options;

  describe('applySyncAction', () => {
    it("'I' adds the row to the pool", () => {
      const store = makeStore();
      const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });

      store.applySyncAction('I', 'row-1', row);

      expect(store.pool.size).toBe(1);
      expect(store.pool.get('row-1')).toEqual(row);
    });

    it("'U' merges/updates the existing row", () => {
      const store = makeStore();
      const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });
      store.applySyncAction('I', 'row-1', row);

      const patch = { ...row, [updateField]: updateValue } as T;
      store.applySyncAction('U', 'row-1', patch);

      expect(store.pool.size).toBe(1);
      expect(store.pool.get('row-1')?.[updateField]).toEqual(updateValue);
    });

    it("'D' removes the row from the pool", () => {
      const store = makeStore();
      const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });
      store.applySyncAction('I', 'row-1', row);

      store.applySyncAction('D', 'row-1', null);

      expect(store.pool.has('row-1')).toBe(false);
      expect(store.pool.size).toBe(0);
    });

    if (archiveIsUpsert) {
      it("'A' archives in place (row stays in the pool with the new data)", () => {
        const store = makeStore();
        const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });
        store.applySyncAction('I', 'row-1', row);

        const archived = { ...row, [updateField]: updateValue } as T;
        store.applySyncAction('A', 'row-1', archived);

        expect(store.pool.has('row-1')).toBe(true);
        expect(store.pool.get('row-1')?.[updateField]).toEqual(updateValue);
      });
    } else {
      it("'A' removes the row from the pool", () => {
        const store = makeStore();
        const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });
        store.applySyncAction('I', 'row-1', row);

        store.applySyncAction('A', 'row-1', null);

        expect(store.pool.has('row-1')).toBe(false);
      });
    }

    it("applying 'I' twice does not double-insert", () => {
      const store = makeStore();
      const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });

      store.applySyncAction('I', 'row-1', row);
      store.applySyncAction('I', 'row-1', row);

      expect(store.pool.size).toBe(1);
    });

    // The two cases below pin the halves of the contract that `applyPoolSyncAction`
    // is now the single owner of across every pool store. Asserting through
    // `pool` rather than `findById` is deliberate: `findById` is `get(id) ?? null`,
    // so a row overwritten with `null` would still read back as `null` and the
    // assertion could not fail.
    it('ignores an upsert verb carrying no payload', () => {
      const store = makeStore();
      const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });
      store.applySyncAction('I', 'row-1', row);

      store.applySyncAction('U', 'row-1', null);
      store.applySyncAction('A', 'row-1', null);

      expect(store.pool.size).toBe(1);
      expect(store.pool.get('row-1')).toEqual(row);
    });

    it('ignores an unrecognised action type', () => {
      const store = makeStore();
      const row = makeRow({ id: 'row-1' } as Partial<T> & { id: string });
      store.applySyncAction('I', 'row-1', row);

      store.applySyncAction('X', 'row-1', makeRow({ id: 'row-1' } as Partial<T> & { id: string }));
      store.applySyncAction('', 'row-2', row);

      expect(store.pool.size).toBe(1);
      expect(store.pool.get('row-1')).toEqual(row);
    });
  });
}
