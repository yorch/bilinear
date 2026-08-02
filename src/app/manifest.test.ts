import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PWA_BACKGROUND_DARK, PWA_BACKGROUND_LIGHT } from '@/lib/pwa';

/**
 * Installability guard for the web app manifest.
 *
 * Nothing else in the repo can catch a broken manifest: lint and typecheck see
 * a well-typed object, the build emits whatever it is given, and the symptom —
 * Chrome quietly not offering to install — is invisible until someone opens
 * the browser on a deployed build. So each of Chrome's manifest-side
 * installability criteria is asserted here, along with the two things a
 * manifest can get wrong without being invalid: pointing at an icon that isn't
 * there, and declaring a size the icon isn't.
 */

// The manifest is localised through `getServerTranslations`, which reads the
// request's cookies and Accept-Language. Stub the request scope rather than
// the translation layer, so the real key lookup still runs.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

const { default: manifest } = await import('./manifest');

const PUBLIC_DIR = join(process.cwd(), 'public');

/** Width and height out of a PNG's IHDR chunk, which is always the first one. */
function pngSize(file: string): { height: number; width: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

describe('web app manifest', () => {
  it('declares the fields Chrome requires to offer installation', async () => {
    const result = await manifest();

    expect(result.name).toBeTruthy();
    expect(result.short_name).toBeTruthy();
    expect(result.start_url).toBe('/');
    expect(result.scope).toBe('/');
    // `browser` would render as an ordinary tab and disqualify the install.
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(result.display);
    // Without an explicit id the browser derives one from start_url, so a
    // later change to start_url would read as a different app, not an update.
    expect(result.id).toBe('/');
    expect(result.description).toBeTruthy();
  });

  it('ships the required icon sizes, including a separate maskable one', async () => {
    const icons = (await manifest()).icons ?? [];
    const bySize = (size: string, purpose: string) =>
      icons.filter(icon => icon.sizes === size && icon.purpose === purpose);

    // Chrome requires both a 192px and a 512px `any` icon.
    expect(bySize('192x192', 'any')).toHaveLength(1);
    expect(bySize('512x512', 'any')).toHaveLength(1);
    // A maskable icon is full-bleed and cropped to the platform's shape; an
    // icon declared as both purposes is wrong for one of them.
    expect(bySize('512x512', 'maskable')).toHaveLength(1);
  });

  it('points every icon at a file that exists and is the declared size', async () => {
    const icons = (await manifest()).icons ?? [];
    expect(icons.length).toBeGreaterThan(0);

    for (const icon of icons) {
      const [width, height] = (icon.sizes ?? '').split('x').map(Number);
      expect(pngSize(join(PUBLIC_DIR, icon.src))).toEqual({ height, width });
    }
  });
});

/**
 * The manifest's colours and the `<meta name="theme-color">` pair are the only
 * colours in the app that can't be a `var()` — the OS reads them before any
 * stylesheet exists. This resolves `--background` out of globals.css the way
 * the cascade would and asserts the literals still match, so the neutral ramp
 * can't drift away from the splash screen and title bar unnoticed.
 *
 * The oklch conversion is duplicated from `src/lib/contrast.test.ts` (the
 * canonical, far more complete resolver) rather than shared: two short
 * functions are a smaller cost than restructuring the contrast guard around
 * an export it doesn't otherwise need.
 */
describe('manifest colours', () => {
  const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  function oklchToRgbString(L: number, C: number, H: number): string {
    const h = (H * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const channels = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(c => {
      const x = Math.min(1, Math.max(0, c));
      return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
    });
    return `rgb(${channels.join(', ')})`;
  }

  /**
   * Last matching `--background` wins, which is the cascade's answer here:
   * the dark blocks are written later and at greater-or-equal specificity by
   * construction (see the SPECIFICITY NOTE in globals.css).
   */
  function background(theme: 'dark' | 'light'): string {
    let found: string | undefined;
    let hue: string | undefined;
    for (const [, selector, body] of CSS.matchAll(/(:root[^{}\n]*?)\s*\{([^{}]*)\}/g)) {
      // Only the accent-less blocks and the default accent's own.
      const accent = selector.match(/data-accent="([\w-]+)"/);
      if (accent && accent[1] !== 'aurora') {
        continue;
      }
      // --accent-h is theme-independent (it drives the ramp in both), so it is
      // read from every block; --background only from the matching theme's.
      hue = body.match(/--accent-h:\s*([\d.]+)/)?.[1] ?? hue;
      if (selector.includes('.dark') !== (theme === 'dark')) {
        continue;
      }
      found = body.match(/--background:\s*oklch\(([^)]*)\)/)?.[1] ?? found;
    }
    expect(found).toBeDefined();
    expect(hue).toBeDefined();
    const [l, c] = (found as string).split(/\s+/);
    return oklchToRgbString(Number(l), Number(c), Number(hue));
  }

  it('matches --background under the default accent', () => {
    expect(PWA_BACKGROUND_LIGHT).toBe(background('light'));
    expect(PWA_BACKGROUND_DARK).toBe(background('dark'));
  });

  it('uses the light background for the manifest', async () => {
    const result = await manifest();
    expect(result.background_color).toBe(PWA_BACKGROUND_LIGHT);
    expect(result.theme_color).toBe(PWA_BACKGROUND_LIGHT);
  });
});
