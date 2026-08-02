import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `canceled` is spelled with one L, everywhere.
 *
 * It is the `WorkflowState.type` value `team.service.ts` seeds and
 * `workflow-state.service.ts` validates, and the `Project.status` value
 * `PROJECT_STATUS_CONFIG` declares. The British `cancelled` is not a synonym
 * here — it is a string that matches nothing.
 *
 * That failure is always silent. Every site is a lookup or a comparison, so a
 * misspelling doesn't throw; it just never matches, and the canceled rows fall
 * into whatever the fallback bucket is. Four of these shipped before this test
 * existed:
 *
 * - `analytics/page.tsx` built an always-empty `canceledStateIds`, so canceled
 *   issues counted as *open* in the completion rate. (The identical bug had
 *   already been fixed once in `analytics.service.ts` — the client copy
 *   survived.)
 * - `sub-issue-list.tsx` never categorised or struck through a canceled
 *   sub-issue.
 * - `public-roadmap-view.tsx` rendered a canceled project with no status badge.
 * - `prisma/seed.ts` seeded a `cancelled` workflow state, so every seeded team
 *   lacked the `canceled` state that triage-decline and duplicate-auto-cancel
 *   both resolve by type — each would have thrown on seeded data.
 *
 * The translation *keys* (`…status.cancelled`, `…categories.cancelled`) are a
 * separate namespace and keep their own spelling; this scan only matches the
 * bare token, so those longer dotted strings don't trip it.
 */

const ROOTS = ['src', 'prisma'];
const EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'generated', 'locales']);

// A quoted `'cancelled'` / `"cancelled"` literal, or an object key
// `cancelled:`. Deliberately NOT a bare `\bcancelled\b`: the codebase uses
// `let cancelled = false` as an effect-teardown flag in many components, and
// that identifier is unrelated.
const OFFENDERS = [/['"]cancelled['"]/, /(^|[{,\s])cancelled\s*:/];

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

describe('state type spelling', () => {
  it('never spells the canceled state/status with two Ls', () => {
    const violations: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        // This file names both offending forms on purpose, as fixtures.
        if (file.endsWith('state-type-spelling.test.ts')) {
          continue;
        }
        const lines = readFileSync(file, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          // Comments explain the rule and legitimately name the wrong spelling.
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
          if (OFFENDERS.some(re => re.test(code))) {
            violations.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it('is non-vacuous — the scan matches both offending forms', () => {
    const literal = "const x = 'cancelled';";
    const key = '{ cancelled: 1 }';

    expect(OFFENDERS.some(re => re.test(literal))).toBe(true);
    expect(OFFENDERS.some(re => re.test(key))).toBe(true);
    // …and does not fire on the unrelated teardown-flag identifier or on the
    // longer translation keys.
    expect(OFFENDERS.some(re => re.test('let cancelled = false;'))).toBe(false);
    expect(OFFENDERS.some(re => re.test("t('a.b.categories.cancelled')"))).toBe(false);
  });
});
