import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accents } from './accent';

/**
 * WCAG contrast guard over the real token layer.
 *
 * The tokens are computed — neutrals derive from `--accent-h`, and every
 * status/brand role derives from its base via `color-mix`. That is what makes
 * the system coherent, and also what makes contrast easy to break by accident:
 * nudging one base lightness silently moves a dozen derived pairs, across
 * three accents and two themes, and nothing in lint/typecheck/build looks at
 * colour at all.
 *
 * This resolves each token exactly as the cascade would, converts oklch to
 * sRGB, composites translucent fills over their backdrop, and asserts the
 * ratio. It is the only gate in the repo that can catch a contrast
 * regression — there is no visual-regression suite.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  // One comment embeds a JSX `style={{ … }}` snippet whose braces would
  // otherwise terminate a block body during parsing.
  .replace(/\/\*[\s\S]*?\*\//g, '');

type Rgb = readonly [number, number, number];
type Rgba = { alpha: number; rgb: Rgb };

// ── colour conversion ──────────────────────────────────────────────────────

function oklchToSrgb(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map(c => {
    const x = Math.min(1, Math.max(0, c));
    return Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  }) as unknown as Rgb;
}

function srgbToOklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToSrgb(L: number, a: number, b: number): Rgb {
  return oklchToSrgb(L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function over({ alpha, rgb }: Rgba, backdrop: Rgb): Rgb {
  return rgb.map((c, i) => alpha * c + (1 - alpha) * backdrop[i]) as unknown as Rgb;
}

// ── cascade resolution ─────────────────────────────────────────────────────

const BLOCK = /(:root[^{}\n]*?)\s*\{([^{}]*)\}/g;

function resolve(accent: string, theme: 'light' | 'dark'): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [, selector, body] of CSS.matchAll(BLOCK)) {
    if (selector.includes('.dark') && theme !== 'dark') {
      continue;
    }
    const named = selector.match(/data-accent="([\w-]+)"/);
    if (named && named[1] !== accent) {
      continue;
    }
    // Source order is the correct precedence here: the dark blocks are written
    // later and at greater-or-equal specificity by construction (see the
    // SPECIFICITY NOTE in globals.css).
    for (const [, prop, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      env[prop] = value.trim();
    }
  }
  return env;
}

function balanced(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '(') {
      depth++;
    } else if (source[i] === ')' && --depth === 0) {
      return source.slice(from, i + 1);
    }
  }
  return source.slice(from);
}

function evaluate(raw: string, env: Record<string, string>, seen = new Set<string>()): Rgba {
  const value = raw.trim();

  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    const name = ref[1];
    if (seen.has(name)) {
      throw new Error(`cyclic token reference at ${name}`);
    }
    const next = env[name];
    if (next === undefined) {
      throw new Error(`undefined token ${name}`);
    }
    return evaluate(next, env, new Set(seen).add(name));
  }

  if (value.startsWith('oklch(')) {
    let body = balanced(value, value.indexOf('(')).slice(1, -1);
    let alpha = 1;
    const slash = body.lastIndexOf('/');
    if (slash !== -1) {
      const raw = body.slice(slash + 1).trim();
      alpha = raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
      body = body.slice(0, slash);
    }
    const parts = body.trim().split(/\s+/);
    const hueRef = parts[2].match(/^var\((--[\w-]+)\)$/);
    const H = hueRef ? Number.parseFloat(env[hueRef[1]]) : Number.parseFloat(parts[2]);
    return { alpha, rgb: oklchToSrgb(Number.parseFloat(parts[0]), Number.parseFloat(parts[1]), H) };
  }

  if (value.startsWith('color-mix(')) {
    const inner = balanced(value, value.indexOf('(')).slice(1, -1);
    const [, rest] = inner.split(/,([\s\S]+)/);
    const pivot = rest.lastIndexOf(',');
    const first = rest.slice(0, pivot).trim();
    const second = rest.slice(pivot + 1).trim();
    const pctMatch = first.match(/([\d.]+)%$/);
    if (!pctMatch) {
      throw new Error(`color-mix without a percentage: ${value}`);
    }
    const pct = Number.parseFloat(pctMatch[1]) / 100;
    const a = evaluate(first.slice(0, pctMatch.index).trim(), env, seen);
    if (second === 'transparent') {
      return { alpha: a.alpha * pct, rgb: a.rgb };
    }
    const bRgb: Rgb =
      second === 'black'
        ? [0, 0, 0]
        : second === 'white'
          ? [1, 1, 1]
          : evaluate(second, env, seen).rgb;
    const ao = srgbToOklab(a.rgb);
    const bo = srgbToOklab(bRgb);
    const mixed = ao.map((c, i) => c * pct + bo[i] * (1 - pct)) as [number, number, number];
    return { alpha: 1, rgb: oklabToSrgb(...mixed) };
  }

  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1];
    return {
      alpha: 1,
      rgb: [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb,
    };
  }

  throw new Error(`unparsed token value: ${value}`);
}

/** The two stops the primary Button actually paints, per theme. */
function ctaStops(env: Record<string, string>): [string, string] {
  const grad = env['--gradient-brand-cta'] ?? '';
  if (grad.includes('var(--gradient-brand)')) {
    return ['var(--brand)', 'var(--brand-2)'];
  }
  const stops: string[] = [];
  let i = 0;
  for (;;) {
    const at = grad.indexOf('color-mix(', i);
    if (at === -1) {
      break;
    }
    const stop = balanced(grad, grad.indexOf('(', at));
    stops.push(`color-mix${stop}`);
    i = at + stop.length;
  }
  return [stops[0] ?? 'var(--brand)', stops[1] ?? 'var(--brand-2)'];
}

// ── the contract ───────────────────────────────────────────────────────────

/** [foreground, background, minimum ratio, what it is] */
const CHECKS: ReadonlyArray<readonly [string, string, number, string]> = [
  ['--foreground', '--background', 4.5, 'body text on page'],
  ['--foreground', '--card', 4.5, 'body text on card'],
  ['--foreground-secondary', '--background', 4.5, 'secondary text'],
  ['--muted-foreground', '--background', 4.5, 'muted text on page'],
  ['--muted-foreground', '--card', 4.5, 'muted text on card'],
  ['--muted-foreground', '--muted', 4.5, 'muted text on muted fill'],
  ['--primary-foreground', '--cta-stop-1', 4.5, 'primary button label (CTA start)'],
  ['--primary-foreground', '--cta-stop-2', 4.5, 'primary button label (CTA end)'],
  ['--destructive-foreground', '--destructive', 4.5, 'destructive button label'],
  // Solid status fill carrying text. `--warning` is a light amber in BOTH
  // themes, so its ink must be dark in both — the `-subtle-foreground` role
  // inverts by theme and rendered light-on-light here.
  ['--warning-foreground', '--warning', 4.5, 'impersonation banner ink'],
  // `--primary` aliases the brand, so it moves with the accent AND is light in
  // dark mode. Every `bg-primary` button that hardcoded `text-white` was
  // therefore white-on-light-azure under Ion. `--primary-foreground` inverts
  // with the theme, which is the whole reason it exists.
  ['--primary-foreground', '--primary', 4.5, 'flat primary button label'],
  ['--brand-subtle-foreground', '--brand-subtle', 4.5, 'brand pill text'],
  ['--danger-subtle-foreground', '--danger-subtle', 4.5, 'danger pill text'],
  ['--success-subtle-foreground', '--success-subtle', 4.5, 'success pill text'],
  ['--warning-subtle-foreground', '--warning-subtle', 4.5, 'warning pill text'],
  ['--info-subtle-foreground', '--info-subtle', 4.5, 'info pill text'],
  ['--merged-subtle-foreground', '--merged-subtle', 4.5, 'merged pill text'],
  ['--danger-subtle-foreground', '--background', 4.5, 'danger text on page'],
  ['--success-subtle-foreground', '--background', 4.5, 'success text on page'],
  ['--warning-subtle-foreground', '--background', 4.5, 'warning text on page'],
  ['--info-subtle-foreground', '--background', 4.5, 'info text on page'],
  // Non-text UI components and state indicators: WCAG 1.4.11, 3:1.
  ['--ring', '--background', 3.0, 'focus ring vs page'],
  ['--ring', '--card', 3.0, 'focus ring vs card'],
  ['--brand', '--background', 3.0, 'selection rail vs page'],
  ['--input', '--card', 3.0, 'control border vs card'],
  ['--input', '--background', 3.0, 'control border vs page'],
  ['--warning', '--background', 3.0, 'vivid warning (due-soon)'],
];

/**
 * Deliberately NOT asserted, and why:
 *
 * - `--border` separates surfaces (row dividers, section rules). It is not the
 *   boundary of a control and carries no state, so 1.4.11 does not apply;
 *   `--input` is the control boundary and IS asserted above.
 * - `--foreground-faint` is reserved for decorative marks — the em-dash
 *   standing in for "no value", and background swatches. Every informational
 *   use was moved to `--muted-foreground`. If you reach for it for real text,
 *   move it instead.
 */

describe('WCAG contrast across every accent and theme', () => {
  const combos = accents.flatMap(accent =>
    (['light', 'dark'] as const).map(theme => ({ accent, theme })),
  );

  it.each(combos)('$accent / $theme meets every declared minimum', ({ accent, theme }) => {
    const env = resolve(accent, theme);
    const [stop1, stop2] = ctaStops(env);
    env['--cta-stop-1'] = stop1;
    env['--cta-stop-2'] = stop2;

    const page = over(evaluate('var(--background)', env), [1, 1, 1]);
    const failures: string[] = [];

    for (const [fgToken, bgToken, minimum, label] of CHECKS) {
      const bg = over(evaluate(`var(${bgToken})`, env), page);
      const fg = over(evaluate(`var(${fgToken})`, env), bg);
      const ratio = contrast(fg, bg);
      if (ratio < minimum) {
        failures.push(`${label}: ${ratio.toFixed(2)} < ${minimum} (${fgToken} on ${bgToken})`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('is not vacuous — a regressed token is caught', () => {
    const env = resolve('aurora', 'light');
    // Mid grey on white is ~3.9:1: plausible-looking, and a real failure.
    env['--muted-foreground'] = 'oklch(0.62 0 0)';
    const bg = over(evaluate('var(--background)', env), [1, 1, 1]);
    const fg = over(evaluate('var(--muted-foreground)', env), bg);
    expect(contrast(fg, bg)).toBeLessThan(4.5);
  });
});
