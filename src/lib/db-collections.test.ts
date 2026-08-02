import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CACHED_COLLECTIONS,
  COLLECTIONS_STAMP_KEY,
  stampCoversRequiredCollections,
} from './db-collections';

describe('stampCoversRequiredCollections', () => {
  it('accepts a stamp listing exactly the required collections', () => {
    expect(stampCoversRequiredCollections([...CACHED_COLLECTIONS])).toBe(true);
  });

  it("accepts a superset — a newer build's cache still satisfies an older one", () => {
    // Rolling a release back must not force every client to re-bootstrap: the
    // cache on disk contains everything this build needs, plus extras it will
    // simply ignore.
    expect(stampCoversRequiredCollections([...CACHED_COLLECTIONS, 'somethingNewer'])).toBe(true);
  });

  it('rejects a stamp missing any single required collection', () => {
    for (const omitted of CACHED_COLLECTIONS) {
      const partial = CACHED_COLLECTIONS.filter(name => name !== omitted);
      expect(stampCoversRequiredCollections(partial)).toBe(false);
    }
  });

  it('rejects a missing or malformed stamp', () => {
    // `undefined` is the shape a cache written before the stamp existed has,
    // and the shape `syncMetadata.get` returns for an absent key.
    expect(stampCoversRequiredCollections(undefined)).toBe(false);
    expect(stampCoversRequiredCollections(null)).toBe(false);
    expect(stampCoversRequiredCollections('teams,users')).toBe(false);
    expect(stampCoversRequiredCollections({ teams: true })).toBe(false);
    expect(stampCoversRequiredCollections([])).toBe(false);
  });

  it('ignores non-string entries rather than counting them as coverage', () => {
    const withJunk: unknown[] = [...CACHED_COLLECTIONS.slice(1), 42, null, { name: 'teams' }];
    expect(stampCoversRequiredCollections(withJunk)).toBe(false);
  });

  it('uses a stable key that a rename would have to update deliberately', () => {
    expect(COLLECTIONS_STAMP_KEY).toBe('cachedCollections');
  });
});

describe('CACHED_COLLECTIONS matches what fullBootstrap actually writes', () => {
  // The stamp is only meaningful if it describes the real write set. If someone
  // adds a collection to `fullBootstrap` and forgets the constant, the stamp
  // would claim a complete cache while the new table stays empty on every
  // existing client — exactly the hole this whole mechanism exists to prevent,
  // reintroduced silently.
  //
  // `fullBootstrap` is the only place that clears entity tables (the delta path
  // deletes by id), so its `db.<name>.clear()` calls are the write set.
  it('is exactly the set of tables the bootstrap transaction clears', () => {
    const source = readFileSync('src/lib/sync-manager.ts', 'utf-8');
    const cleared = [...source.matchAll(/db\.(\w+)\.clear\(\)/g)].map(m => m[1]);

    expect(cleared.length).toBeGreaterThan(0);
    expect([...new Set(cleared)].sort()).toEqual([...CACHED_COLLECTIONS].sort());
  });

  it('never lists the collections bootstrap must not own', () => {
    // `pendingTransactions` is the offline queue — the one thing in the cache
    // that exists nowhere else, so bootstrap must never clear it. `favorites`
    // is delta-only and served from GraphQL, so bootstrap can never satisfy a
    // claim to hold it and listing it would loop every client through
    // re-bootstrap forever. `syncMetadata` holds the stamp itself.
    for (const name of ['pendingTransactions', 'favorites', 'syncMetadata']) {
      expect(CACHED_COLLECTIONS as readonly string[]).not.toContain(name);
    }
  });
});
