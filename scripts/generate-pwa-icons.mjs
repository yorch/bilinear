#!/usr/bin/env node
/**
 * Regenerate the PWA icon set in `public/icons/`.
 *
 * The icons are committed binaries, so this script is their source: run it
 * whenever the mark, the brand gradient or the UI typeface changes, then
 * commit the PNGs it writes. Nothing in the build or the test suite invokes
 * it — but a committed asset no one can reproduce is worse than no asset at
 * all, which is why the generator lives in the repo rather than the PNGs
 * having come from some external tool.
 *
 * Rendering goes through the Chromium that Playwright already installs for
 * the e2e suite, because that is the one rasteriser guaranteed to agree with
 * what the app itself renders: the gradient is written in the same `oklch()`
 * values as `globals.css` (Chromium converts them), and the glyph is set in
 * the very same vendored Instrument Sans file `next/font/local` loads.
 *
 * Usage:
 *   node scripts/generate-pwa-icons.mjs
 *   CHROME_PATH=/path/to/chrome node scripts/generate-pwa-icons.mjs
 *
 * Requires the Playwright browsers (`yarn playwright install chromium`), or a
 * Chromium/Chrome of your own pointed at by CHROME_PATH.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const FONT_PATH = path.join(ROOT, 'src', 'app', 'fonts', 'InstrumentSans-Variable-latin.woff2');

/**
 * The typeface is inlined as a data: URI rather than referenced by `file://`.
 * The page is loaded via `setContent`, which serves it from `about:blank`, and
 * Chromium refuses `file://` subresources from that origin — the font would
 * silently fall back to a serif and the mark would ship in the wrong typeface.
 */
const FONT_DATA_URI = `data:font/woff2;base64,${readFileSync(FONT_PATH).toString('base64')}`;

/**
 * The Aurora accent's two gradient stops, verbatim from `globals.css`
 * (`--swatch-aurora-1` / `--swatch-aurora-2`).
 *
 * The icon deliberately does NOT follow the user's selected accent: it is
 * baked into the installed app's launcher entry at install time, so it has to
 * be one fixed mark. Aurora is the default accent, so that is the one.
 */
const BRAND_1 = 'oklch(0.585 0.233 277.117)';
const BRAND_2 = 'oklch(0.627 0.233 303.9)';

/**
 * Icons to produce.
 *
 * `radius` is a percentage of the icon's own size and `glyph` is the font size
 * as a fraction of it. The maskable variant is the one that needs care: a
 * platform may crop it to any shape inside the safe zone — a circle of 80%
 * diameter — so it is full-bleed (no corners of its own; the platform adds
 * them) with a glyph small enough to survive the crop.
 */
const VARIANTS = [
  { glyph: 0.62, name: 'icon-192.png', radius: 22, size: 192 },
  { glyph: 0.62, name: 'icon-512.png', radius: 22, size: 512 },
  { glyph: 0.44, name: 'icon-maskable-512.png', radius: 0, size: 512 },
  // iOS masks the apple-touch-icon itself and composites anything transparent
  // onto black, so this one is full-bleed with the tile's glyph proportions.
  { glyph: 0.62, name: 'apple-touch-icon-180.png', radius: 0, size: 180 },
];

function html({ glyph, radius, size }) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Instrument Sans';
    src: url('${FONT_DATA_URI}') format('woff2');
    font-weight: 400 700;
  }
  html, body { margin: 0; padding: 0; background: transparent; }
  .tile {
    width: ${size}px;
    height: ${size}px;
    border-radius: ${radius}%;
    background: linear-gradient(135deg, ${BRAND_1}, ${BRAND_2});
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .glyph {
    font-family: 'Instrument Sans';
    font-weight: 700;
    font-size: ${Math.round(size * glyph)}px;
    line-height: 1;
    color: #ffffff;
  }
</style>
<div class="tile"><span class="glyph">B</span></div>
`;
}

mkdirSync(OUT_DIR, { recursive: true });

// Playwright pins an exact Chromium build; an environment that ships its own
// (a CI image, this repo's sandbox) can point at it instead of downloading.
const executablePath = process.env.CHROME_PATH;
if (executablePath && !existsSync(executablePath)) {
  throw new Error(`CHROME_PATH does not exist: ${executablePath}`);
}
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  for (const variant of VARIANTS) {
    await page.setViewportSize({ height: variant.size, width: variant.size });
    await page.setContent(html(variant));
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(OUT_DIR, variant.name);
    // Screenshot the tile itself rather than the viewport: the element's own
    // box is exactly the icon, so nothing depends on how the headless window
    // sizes its viewport. `omitBackground` is what keeps the rounded variants'
    // corners transparent instead of compositing them onto white.
    await page.locator('.tile').screenshot({ omitBackground: true, path: out });
    process.stdout.write(`wrote ${path.relative(ROOT, out)} (${variant.size}x${variant.size})\n`);
  }
} finally {
  await browser.close();
}
