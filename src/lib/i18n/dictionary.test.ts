import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';

/**
 * The dictionary fails silently, in both directions.
 *
 * `translate()` returns the *key* when a lookup misses, so a `t()` call naming a
 * key nobody ever added renders the dotted path itself into the UI — no throw,
 * no warning, no type error (the key parameter is a bare `string`). Two of those
 * shipped before this test existed:
 *
 * - `csv-export-button.tsx` asked for `issues.cycleNumber`, which was never
 *   defined, so every exported CSV wrote the literal text `issues.cycleNumber`
 *   into the Cycle column for any cycle without a custom name.
 * - `create-project-modal.tsx` asked for `projects.status.label`, so the
 *   create-project form's status field was labelled `projects.status.label`.
 *
 * The same silence covers the locale files: a key added to `en.json` and
 * forgotten in `es.json` falls back to English mid-sentence, and a `{placeholder}`
 * dropped from one translation renders an unsubstituted token or silently loses
 * the value.
 *
 * So: every literal key the source asks for must exist, both locales must carry
 * the same keys, and each key's placeholders must match across locales.
 */

const ROOT = 'src';
const EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'generated', 'locales']);

/** CLDR plural-category suffixes `resolvePluralRaw()` appends to a base key. */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

/**
 * A `t('some.key')` call with a single-quoted literal key. Deliberately only
 * single quotes: Biome enforces them, so a double-quoted or template-literal
 * argument is a computed key (`t(labelKey)`, `t(`a.${b}`)`) that this scan
 * cannot resolve statically and must not guess at.
 */
const LITERAL_T_CALL = /\bt\(\s*'([a-zA-Z][\w.]*)'/g;

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}) {
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') {
      flatten(child, path, out);
    } else {
      out[path] = String(child);
    }
  }
  return out;
}

const EN = flatten(en);
const ES = flatten(es);

/** Placeholder tokens (`{count}`, `{name}`) a translation interpolates. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
}

/** The base names of every pluralized key, e.g. `issues.issuesCount`. */
function pluralBases(dict: Record<string, string>): Set<string> {
  const bases = new Set<string>();
  for (const key of Object.keys(dict)) {
    const suffix = PLURAL_SUFFIXES.find(s => key.endsWith(s));
    if (suffix) {
      bases.add(key.slice(0, -suffix.length));
    }
  }
  return bases;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some(ext => full.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe('translation dictionary', () => {
  it('defines every key the source asks for by literal', () => {
    const bases = pluralBases(EN);
    const violations: string[] = [];

    for (const file of walk(ROOT)) {
      // Tests name made-up keys as fixtures (this file included).
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
        continue;
      }
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          for (const [, key] of line.matchAll(LITERAL_T_CALL)) {
            if (!(key in EN) && !bases.has(key)) {
              violations.push(`${file}:${i + 1}: t('${key}') — no such key`);
            }
          }
        });
    }

    expect(violations).toEqual([]);
  });

  it('carries the same keys in every locale', () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
  });

  it('interpolates the same placeholders in every locale', () => {
    const mismatched = Object.keys(EN)
      .filter(key => key in ES)
      .filter(key => placeholders(EN[key]).join() !== placeholders(ES[key]).join())
      .map(key => `${key}: en=${placeholders(EN[key])} es=${placeholders(ES[key])}`);

    expect(mismatched).toEqual([]);
  });

  it('gives every pluralized key an `_other` fallback in every locale', () => {
    // `resolvePluralRaw()` falls back to `_other` when the count selects a CLDR
    // category the locale does not define, so a base missing `_other` renders
    // the raw key for those counts.
    const missing: string[] = [];
    for (const [locale, dict] of [
      ['en', EN],
      ['es', ES],
    ] as const) {
      for (const base of pluralBases(dict)) {
        if (!(`${base}_other` in dict)) {
          missing.push(`${locale}: ${base}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('is non-vacuous — the scan and the comparisons catch real breakage', () => {
    // The key scanner finds literal calls and ignores computed ones.
    const found = [...`t('nav.myIssues') t('a.b')`.matchAll(LITERAL_T_CALL)].map(m => m[1]);
    expect(found).toEqual(['nav.myIssues', 'a.b']);
    expect([...'t(labelKey)'.matchAll(LITERAL_T_CALL)]).toEqual([]);

    // A key the dictionary really lacks is reported, and a real one is not.
    expect('nav.myIssues' in EN).toBe(true);
    expect('issues.cycleNumber' in EN).toBe(false);

    // Placeholder comparison distinguishes differing token sets.
    expect(placeholders('{count} of {max}')).toEqual(['count', 'max']);
    expect(placeholders('{count} de')).not.toEqual(placeholders('{count} of {max}'));

    // Plural bases are derived from suffixed siblings, not invented.
    expect(pluralBases({ 'x.y_one': 'a', 'x.y_other': 'b' })).toEqual(new Set(['x.y']));
    expect(pluralBases({ 'x.y': 'a' })).toEqual(new Set());
  });
});
