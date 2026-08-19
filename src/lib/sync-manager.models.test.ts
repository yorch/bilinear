import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BESPOKE_MODELS, CACHED_MODELS, UNCACHED_MODELS } from './sync-manager';

/**
 * `applyActions` decides, per model name, which store receives a SyncAction and
 * which Dexie table mirrors it. Nothing type-checks that mapping against what the
 * server actually emits: a new synced entity ships a `createSyncAction('X', …)`
 * on the server and, if nobody adds the client half, every client drops it
 * silently. Rows never reach the offline cache, and nothing fails — which is
 * exactly how `Organization` went unhandled for months.
 *
 * This closes that loop. The server side is scanned from source — like
 * `graphql-documents.test.ts` and `dictionary.test.ts` do, because those call
 * sites exist only as scattered text with no importable index, and pulling
 * `src/server/**` into a client test would drag Prisma in with it. The client
 * side is simply imported: `CACHED_MODELS` is a module-level table, so the
 * assertions read the real registry rather than a regex's opinion of it.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'src', 'server');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'generated' ? [] : listSourceFiles(full);
    }
    return entry.endsWith('.ts') && !entry.includes('.test.') ? [full] : [];
  });
}

/**
 * Model names passed to `createSyncAction(orgId, action, modelName, …)`. Both
 * call shapes appear in the tree — all on one line, and one argument per line —
 * so the third argument is matched across newlines.
 */
function emittedModelNames(): Map<string, string> {
  const found = new Map<string, string>();
  // The first argument may itself contain a call with commas, and the action may
  // be a dotted expression rather than a literal or bare identifier — both forms
  // exist or plausibly will, and a miss here is silent (the model simply never
  // gets a case generated for it).
  const call =
    /createSyncAction\(\s*(?:[^,()]|\([^()]*\))+,\s*(?:'[A-Z]'|[\w.]+)\s*,\s*'([A-Za-z]+)'/g;
  for (const file of listSourceFiles(SERVER_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(call)) {
      if (!found.has(match[1])) {
        found.set(match[1], relative(REPO_ROOT, file));
      }
    }
  }
  return found;
}

describe('SyncAction model coverage', () => {
  const emitted = emittedModelNames();
  const registryModels = [...CACHED_MODELS.keys()];
  const handled = new Set([...registryModels, ...BESPOKE_MODELS, ...UNCACHED_MODELS]);

  it('finds the models the server emits', () => {
    // Guards the scanner itself: if the regex stops matching, every assertion
    // below passes vacuously over an empty set.
    expect(emitted.size).toBeGreaterThan(15);
    expect([...emitted.keys()]).toContain('Issue');
  });

  it.each([...emitted.entries()])('handles %s, which the server emits from %s', modelName => {
    expect(
      handled.has(modelName),
      `'${modelName}' is emitted by the server but sync-manager neither caches it nor lists it ` +
        'in UNCACHED_MODELS. Add it to CACHED_MODELS with its Dexie table, give it a case arm, ' +
        'or declare it uncached — silently dropping it means rows never reach the offline cache.',
    ).toBe(true);
  });

  // The failure this guards is the one that loses data silently: a model wired
  // to another model's Dexie table still type-checks (every bucket is
  // `object[]`), still applies to the right MobX store, and only shows up as
  // rows missing from the offline cache after a reload. Every entry follows
  // `lowerFirst(model) + 's'`, so the pairing is checkable rather than merely
  // reviewable.
  it.each([...CACHED_MODELS].map(([model, { table }]) => [model, table] as const))(
    'caches %s in the %s table',
    (modelName, table) => {
      expect(table).toBe(`${modelName[0].toLowerCase()}${modelName.slice(1)}s`);
    },
  );

  it('does not list a model as uncached while also caching it', () => {
    const cached = new Set<string>([...registryModels, ...BESPOKE_MODELS]);
    expect(UNCACHED_MODELS.filter(model => cached.has(model))).toEqual([]);
  });

  // The suite's main direction is emitted ⊆ handled, because that is the one
  // that loses data. This is the cheap other half: an entry left behind for a
  // model the server stopped emitting is dead weight nothing else would flag.
  it('does not cache a model the server no longer emits', () => {
    const handledHere = [...registryModels, ...BESPOKE_MODELS];
    expect(handledHere.filter(model => !emitted.has(model))).toEqual([]);
  });
});
