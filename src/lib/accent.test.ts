import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCENT_COOKIE,
  ACCENT_DEFINITIONS,
  accentSwatchGradient,
  accents,
  defaultAccent,
  isAccent,
} from './accent';

const GLOBALS_CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('accent registry', () => {
  it('exposes a definition for every accent, in the same order', () => {
    expect(ACCENT_DEFINITIONS.map(d => d.id)).toEqual([...accents]);
  });

  it('has a default that is a real accent', () => {
    expect(isAccent(defaultAccent)).toBe(true);
  });

  it('guards non-accents', () => {
    expect(isAccent('aurora')).toBe(true);
    expect(isAccent('AURORA')).toBe(false);
    expect(isAccent('teal')).toBe(false);
    expect(isAccent('')).toBe(false);
    expect(isAccent(undefined)).toBe(false);
    expect(isAccent(null)).toBe(false);
  });

  // The swatches are rendered via inline style from .ts, which `yarn
  // lint:tokens` scans at a zero baseline. Referencing a custom property
  // rather than inlining hex is what keeps that guard passing, so assert it
  // here too — lint:tokens only catches the specific literal shapes it knows.
  it('references swatch colours as custom properties, never literals', () => {
    for (const definition of ACCENT_DEFINITIONS) {
      for (const stop of definition.swatch) {
        expect(stop).toMatch(/^var\(--swatch-[a-z0-9-]+\)$/);
      }
    }
  });

  it('builds a gradient from both stops', () => {
    const [aurora] = ACCENT_DEFINITIONS;
    expect(accentSwatchGradient(aurora)).toBe(
      `linear-gradient(135deg, ${aurora.swatch[0]}, ${aurora.swatch[1]})`,
    );
  });
});

describe('globals.css accent blocks', () => {
  it('defines the swatch custom property behind every registry reference', () => {
    for (const definition of ACCENT_DEFINITIONS) {
      for (const stop of definition.swatch) {
        const property = stop.slice('var('.length, -1);
        expect(GLOBALS_CSS).toContain(`${property}:`);
      }
    }
  });

  it('declares a light and a dark brand block for every accent', () => {
    for (const { id } of ACCENT_DEFINITIONS) {
      expect(GLOBALS_CSS).toContain(`:root[data-accent="${id}"]`);
      expect(GLOBALS_CSS).toContain(`:root.dark[data-accent="${id}"]`);
    }
  });

  it('declares an --accent-h hue for every accent', () => {
    for (const { id } of ACCENT_DEFINITIONS) {
      const block = GLOBALS_CSS.split(`:root[data-accent="${id}"]`)[1] ?? '';
      expect(block.slice(0, 200)).toMatch(/--accent-h:|--brand:/);
    }
  });

  /**
   * The dark blocks have to out-rank the light ones. A light
   * `:root[data-accent='ion']` is (0,2,0) and would otherwise beat a bare
   * `.dark` at (0,1,0), leaving dark mode painted with light-mode brand
   * colours. Writing every dark block as `:root.dark[...]` (0,3,0) is what
   * prevents that, so guard the shape rather than trusting a comment.
   */
  it('scopes dark accent blocks with :root.dark so they out-rank the light blocks', () => {
    const darkAccentSelectors = GLOBALS_CSS.match(/^[^\n{]*\.dark\[data-accent[^\n{]*/gm) ?? [];
    expect(darkAccentSelectors).toHaveLength(ACCENT_DEFINITIONS.length);
    for (const selector of darkAccentSelectors) {
      expect(selector.trim()).toMatch(/^:root\.dark\[data-accent="[a-z]+"\]/);
    }
  });

  it('keeps semantic colours off the accent hue', () => {
    // Priority swatches encode data, not brand — they must stay literal and
    // identical under every accent.
    for (const priority of ['none', 'urgent', 'high', 'medium', 'low']) {
      const match = GLOBALS_CSS.match(new RegExp(`--priority-${priority}:\\s*([^;]+);`));
      expect(match?.[1]).toBeDefined();
      expect(match?.[1]).not.toContain('--accent-h');
      expect(match?.[1]).not.toContain('--brand');
    }
  });
});

describe('getServerAccent', () => {
  async function resolveWith(cookieValue: string | undefined) {
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      cookies: () =>
        Promise.resolve({
          get: (name: string) =>
            name === ACCENT_COOKIE && cookieValue !== undefined
              ? { name, value: cookieValue }
              : undefined,
        }),
    }));
    const { getServerAccent } = await import('./accent-server');
    return getServerAccent();
  }

  it('returns the cookie value when it names a real accent', async () => {
    await expect(resolveWith('ion')).resolves.toBe('ion');
    await expect(resolveWith('ultraviolet')).resolves.toBe('ultraviolet');
  });

  it('falls back to the default when the cookie is missing', async () => {
    await expect(resolveWith(undefined)).resolves.toBe(defaultAccent);
  });

  it('falls back to the default when the cookie is not a known accent', async () => {
    // A stale cookie from a removed accent must not reach `data-accent`,
    // where it would match no CSS block at all.
    await expect(resolveWith('chartreuse')).resolves.toBe(defaultAccent);
    await expect(resolveWith('')).resolves.toBe(defaultAccent);
  });
});
