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

// Every shade-numbered Tailwind palette hue, with any (or no) property prefix
// (bg-, text-, border-, hover:text-, dark:bg-, etc.), plus 3/6-digit hex
// literals.
//
// This originally covered only `zinc` and `indigo` — the greys and the brand —
// which left a second population of raw colours completely unguarded: 330
// red/amber/green/blue status usages had accumulated across 49 files while the
// baseline read as a clean literal zero. Those now route through the status
// token family (--danger/--success/--warning/--info, plus --merged for
// GitHub's merged purple), and the guard covers the whole palette so the same
// blind spot can't reopen behind a different hue.
const PALETTE_HUES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

const VIOLATION_RE = new RegExp(
  `(?:^|[\\s"'\`:])[\\w-]*(?:${PALETTE_HUES})-\\d{2,3}(?:\\/\\d{1,3})?\\b` +
    '|#[0-9a-fA-F]{6}\\b' +
    '|#[0-9a-fA-F]{3}\\b(?![0-9a-fA-F])',
  'g',
);

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

/**
 * A border width with no border colour anywhere in the same class string.
 *
 * Tailwind v4's preflight resets borders to `border: 0 solid` and sets no
 * colour, so `border-color` keeps its CSS initial value — `currentColor`. A
 * bare `className="rounded-lg border p-6"` therefore draws the border in the
 * element's TEXT colour, which is `--foreground`: the settings cards rendered
 * with near-black hairlines while every other card in the app used
 * `--border`. It reads as a different design system on the same screen, and
 * neither the palette guard above nor the type-checker can see it.
 *
 * This one is a hard zero rather than a ratchet: the whole tree was fixed in
 * one pass, so there is no legacy population to grandfather.
 */
const BORDER_WIDTH_ONLY = /^border(-[btlrxy])?(-\d+)?$/;
const BORDER_COLOUR = /^border-(?![btlrxy]?\d*$)(?![btlrxy]$).+/;
const CLASS_STRING_RE = /["'`]([a-zA-Z0-9:@\-[\]/.,%()#& ]{4,})["'`]/g;

/**
 * How far after a class string to look for an inline `style={{ borderColor }}`.
 *
 * Some borders are coloured from per-row data — a workflow state's own colour —
 * which is a legitimate inline style, not a token bypass. Detecting that from
 * the source beats an allowlist of `file:line` pairs, which silently goes stale
 * the moment anyone inserts a line above one of them.
 *
 * Generous on purpose: a `style` object that also sets backgroundColor pushes
 * borderColor several lines down. The cost of over-reaching is missing a bare
 * `border` that happens to sit near an unrelated borderColor, which is a far
 * cheaper failure than a stale allowlist.
 */
const INLINE_STYLE_LOOKAHEAD = 600;

/**
 * Comments, so a class string quoted inside one is not mistaken for markup.
 * (The comment explaining this very fix quoted `h-12 border-b`, and the guard
 * flagged it.)
 */
function stripComments(text) {
  // Blanked, not deleted: newlines are preserved so reported line numbers still
  // match the file the reader will open.
  const blank = m => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/[^\n]*)/gm, (_m, prefix, comment) => prefix + blank(comment));
}

/**
 * Whether a string plausibly IS a class list rather than prose that happens to
 * contain the word "border".
 *
 * `contrast.test.ts` names a case "control border vs card", which the naive
 * check flagged. Real class lists carry at least one hyphenated or prefixed
 * utility; a lone `"border"` is kept because that spelling is itself the bug.
 */
function looksLikeClassList(raw) {
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return BORDER_WIDTH_ONLY.test(tokens[0]);
  }
  return tokens.some(t => t.includes('-') || t.includes(':'));
}

function findColourlessBorders() {
  const found = [];
  for (const root of ROOTS) {
    for (const file of globSync(`${root}/**/*.{ts,tsx}`, { cwd: ROOT })) {
      if (/\.test\.tsx?$/.test(file)) {
        continue;
      }
      const text = stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
      for (const match of text.matchAll(CLASS_STRING_RE)) {
        if (!looksLikeClassList(match[1])) {
          continue;
        }
        const classes = match[1].split(/\s+/).map(c => c.split(':').pop());
        const hasWidth = classes.some(c => BORDER_WIDTH_ONLY.test(c) && c !== 'border-0');
        if (!hasWidth || classes.some(c => BORDER_COLOUR.test(c))) {
          continue;
        }
        const after = text.slice(match.index, match.index + INLINE_STYLE_LOOKAHEAD);
        if (after.includes('borderColor')) {
          continue;
        }
        const line = text.slice(0, match.index).split('\n').length;
        found.push({ classes: match[1].slice(0, 80), file, line });
      }
    }
  }
  return found;
}

function checkColourlessBorders() {
  const found = findColourlessBorders();
  if (found.length === 0) {
    return;
  }
  console.error(
    'Border width with no border colour. Tailwind v4 resets borders to ' +
      '`border: 0 solid` without a colour, so these render in currentColor ' +
      '(the text colour) instead of a token.',
  );
  console.error('Add `border-border` (surfaces) or `border-input` (control boundaries).\n');
  for (const { file, line, classes } of found) {
    console.error(`  ${file}:${line}  ${classes}`);
  }
  process.exit(1);
}

function main() {
  const update = process.argv.includes('--update');
  const current = scan();

  if (update) {
    const baseline = existsSync(BASELINE_PATH)
      ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
      : {};

    // Check for any file whose count would increase
    const increases = [];
    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        increases.push({ allowed, count, file });
      }
    }

    if (increases.length > 0) {
      console.error('Cannot update baseline: raw color usage would increase in these files:');
      for (const { file, count, allowed } of increases) {
        console.error(`  ${file}: ${count} violations (baseline allows ${allowed})`);
      }
      console.error(
        '\nBaseline can only shrink or stay the same. Clean up the violations above first.',
      );
      process.exit(1);
    }

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
    console.error('Design-token regression: raw Tailwind-palette/hex color usage increased.');
    console.error(
      'Use semantic tokens instead — surfaces (bg-card, bg-muted, border-border), ink ' +
        '(text-foreground, text-muted-foreground), brand (bg-brand, text-brand-subtle-foreground), ' +
        'or status (text-danger-subtle-foreground, bg-success-subtle, border-warning/40).',
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

  checkColourlessBorders();

  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`Design tokens OK: ${total} pre-existing raw-color usages at or below baseline.`);
  console.log('Border colours OK: every border width names a token.');
}

main();
