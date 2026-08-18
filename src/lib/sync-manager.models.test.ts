import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNCACHED_MODELS } from './sync-manager';

/**
 * `applyActions` decides, per model name, which store receives a SyncAction and
 * which Dexie table mirrors it. Nothing type-checks that mapping against what the
 * server actually emits: a new synced entity ships a `createSyncAction('X', …)`
 * on the server and, if nobody adds the client half, every client drops it
 * silently. Rows never reach the offline cache, and nothing fails — which is
 * exactly how `Organization` went unhandled for months.
 *
 * This closes that loop by reading both sides from source. Like
 * `graphql-documents.test.ts` and `dictionary.test.ts`, it scans rather than
 * imports, because the registry closes over per-call store instances and cannot
 * be evaluated standalone.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'src', 'server');
const SYNC_MANAGER = join(REPO_ROOT, 'src', 'lib', 'sync-manager.ts');

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
  const call = /createSyncAction\(\s*[^,]+,\s*(?:'[A-Z]'|\w+)\s*,\s*'([A-Za-z]+)'/g;
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

function syncManagerSource(): string {
  return readFileSync(SYNC_MANAGER, 'utf8');
}

/** `model name -> Dexie table` pairs from the `CACHED_MODELS` registry literal. */
function registryEntries(source: string): Array<[string, string]> {
  const start = source.indexOf('const CACHED_MODELS');
  const end = source.indexOf('\n    };', start);
  expect(start, 'CACHED_MODELS registry not found').toBeGreaterThan(-1);
  const body = source.slice(start, end);
  return [
    ...body.matchAll(/^\s{6}([A-Z][A-Za-z]*): cache\((?:.|\n)*?'([a-zA-Z]+)',?\n?\s*\),?$/gm),
  ].map(m => [m[1], m[2]] as [string, string]);
}

function registryModels(source: string): string[] {
  return registryEntries(source).map(([model]) => model);
}

/** `Team` -> `teams`, `CustomFieldDefinition` -> `customFieldDefinitions`. */
function expectedTable(modelName: string): string {
  return `${modelName[0].toLowerCase()}${modelName.slice(1)}s`;
}

/** Model names given their own `case` arm, for the non-uniform handling. */
function bespokeModels(source: string): string[] {
  return [...source.matchAll(/^\s{8}case '([A-Za-z]+)':/gm)].map(m => m[1]);
}

describe('SyncAction model coverage', () => {
  const emitted = emittedModelNames();
  const source = syncManagerSource();
  const handled = new Set([
    ...registryModels(source),
    ...bespokeModels(source),
    ...UNCACHED_MODELS,
  ]);

  it('finds the models the server emits', () => {
    // Guards the scanner itself: if the regex stops matching, every assertion
    // below passes vacuously over an empty set.
    expect(emitted.size).toBeGreaterThan(15);
    expect([...emitted.keys()]).toContain('Issue');
  });

  it('finds the registry and the bespoke cases', () => {
    expect(registryModels(source).length).toBeGreaterThan(10);
    expect(bespokeModels(source)).toEqual(
      expect.arrayContaining(['Organization', 'Issue', 'Notification']),
    );
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
  // to another model's Dexie table still type-checks (both buckets are
  // `object[]`), still applies to the right MobX store, and only shows up as
  // rows missing from the offline cache after a reload. Every one of the
  // seventeen entries follows `lowerFirst(model) + 's'`, so the pairing is
  // checkable rather than merely reviewable.
  it.each(registryEntries(source))('caches %s in the %s table', (modelName, table) => {
    expect(table).toBe(expectedTable(modelName));
  });

  it('reads a table for every registry entry', () => {
    // Non-vacuity: a regex that stopped capturing tables would make the pairing
    // assertions above disappear rather than fail.
    expect(registryEntries(source).length).toBe(registryModels(source).length);
    expect(registryEntries(source).every(([, table]) => table.length > 0)).toBe(true);
  });

  it('does not list a model as uncached while also caching it', () => {
    const cached = new Set([...registryModels(source), ...bespokeModels(source)]);
    expect(UNCACHED_MODELS.filter(m => cached.has(m))).toEqual([]);
  });
});
