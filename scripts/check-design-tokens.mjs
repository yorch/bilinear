#!/usr/bin/env node
/**
 * Design-token regression guard (docs/UI_UX_ASSESSMENT.md §2 RC1).
 *
 * Bans raw `zinc-*`/`indigo-*` Tailwind color classes and hardcoded hex
 * colors in src/components and src/app, using a ratchet baseline rather
 * than an all-or-nothing ban: the codebase still has legacy raw-color
 * usage that hasn't been migrated yet (tracked, not hidden), but CI fails
 * if a file's violation count goes UP — i.e. new code can't add more of
 * what the token migration is actively removing, and cleanup work only
 * ever needs to make the baseline shrink.
 *
 * Usage:
 *   node scripts/check-design-tokens.mjs             # check (CI mode)
 *   node scripts/check-design-tokens.mjs --update     # regenerate baseline
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'design-tokens-baseline.json');
const ROOTS = ['src/components', 'src/app', 'src/lib', 'src/hooks'];

// zinc-*/indigo-* utility classes with any (or no) property prefix
// (bg-, text-, border-, hover:text-, dark:bg-, etc.), plus 3/6-digit hex
// literals — the two raw-color forms the token migration replaces.
const VIOLATION_RE =
  /(?:^|[\s"'`:])[\w-]*(?:zinc|indigo)-\d{2,3}(?:\/\d{1,3})?\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g;

function countViolations(text) {
  const matches = text.match(VIOLATION_RE);
  return matches ? matches.length : 0;
}

function scan() {
  const counts = {};
  for (const root of ROOTS) {
    for (const file of globSync(`${root}/**/*.{ts,tsx}`, {
      cwd: ROOT,
      ignore: `${root}/**/*.test.{ts,tsx}`,
    })) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      const count = countViolations(text);
      if (count > 0) {
        counts[file] = count;
      }
    }
  }
  return counts;
}

function main() {
  const update = process.argv.includes('--update');
  const current = scan();

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    console.log(`Baseline updated: ${Object.keys(current).length} files, ${total} violations.`);
    return;
  }

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

  const regressions = [];
  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      regressions.push({ allowed, count, file });
    }
  }

  if (regressions.length > 0) {
    console.error('Design-token regression: raw zinc-/indigo-/hex color usage increased.');
    console.error(
      'Use semantic tokens (bg-card, text-muted-foreground, border-border, bg-primary, ...) instead.',
    );
    console.error('See docs/UI_UX_ASSESSMENT.md §2 RC1 for the token reference.\n');
    for (const { file, count, allowed } of regressions) {
      console.error(`  ${file}: ${count} violations (baseline allows ${allowed})`);
    }
    console.error(
      "\nIf this file's count went DOWN (you migrated some raw colors), run " +
        '`node scripts/check-design-tokens.mjs --update` to shrink the baseline.',
    );
    process.exit(1);
  }

  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`Design tokens OK: ${total} pre-existing raw-color usages at or below baseline.`);
}

main();
