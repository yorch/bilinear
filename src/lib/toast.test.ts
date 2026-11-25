import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Toaster } from './toast';

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Declarations of every custom property in the `:root` / `:root.dark` blocks (top-level, not accent overrides). */
function tokens(selector: ':root' | ':root.dark'): Map<string, string> {
  const map = new Map<string, string>();
  const re = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{`, 'g');
  for (const m of CSS.matchAll(re)) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < CSS.length) {
      depth += CSS[i] === '{' ? 1 : CSS[i] === '}' ? -1 : 0;
      i++;
    }
    for (const d of CSS.slice(start, i - 1).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      map.set(d[1], d[2].trim());
    }
  }
  return map;
}

const LIGHT = tokens(':root');
const DARK = tokens(':root.dark');

/** Does `value` (resolved through other tokens) carry alpha < 1? */
function hasAlpha(value: string, theme: Map<string, string>, seen = new Set<string>()): boolean {
  if (/\btransparent\b|\/\s*[\d.]+%?\s*\)/.test(value)) {
    return true;
  }
  for (const ref of value.matchAll(/var\((--[\w-]+)/g)) {
    if (seen.has(ref[1])) {
      continue;
    }
    seen.add(ref[1]);
    const next = theme.get(ref[1]);
    if (next && hasAlpha(next, theme, seen)) {
      return true;
    }
  }
  return false;
}

function translucentTokens(): Set<string> {
  const out = new Set<string>();
  for (const theme of [LIGHT, DARK]) {
    for (const [name, value] of theme) {
      if (hasAlpha(value, theme)) {
        out.add(name);
      }
    }
  }
  return out;
}

describe('Toaster theming', () => {
  const el = Toaster({}) as unknown as {
    props: { className: string; style: Record<string, string> };
  };

  it('paints info toasts from the info tokens, not sonner’s fixed pale-blue palette', () => {
    expect(el.props.style['--info-text']).toBe('var(--info-subtle-foreground)');
    expect(el.props.style['--info-bg']).toContain('var(--info)');
    expect(el.props.style['--info-bg']).toContain('var(--popover)');
  });

  it('uses only token references (no raw colours) so dark mode follows the class theme', () => {
    for (const value of Object.values(el.props.style)) {
      expect(value).toMatch(/var\(--/);
      expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|hsl\(|rgb\(/i);
    }
  });

  it('remaps the sonner greys that surface on a toast (close-button hover is near-white in dark otherwise)', () => {
    for (const key of ['--gray2', '--gray4', '--gray5', '--gray11']) {
      expect(el.props.style[key], key).toMatch(/var\(--/);
    }
    // The hover disc must be derived from the opaque popover, not a light grey.
    expect(el.props.style['--gray2']).toContain('var(--popover)');
    expect(el.props.style['--gray5']).toContain('var(--popover)');
  });

  describe('opacity, proven against the real token layer', () => {
    const translucent = translucentTokens();

    it('the parser finds the known translucent tokens (so an empty set cannot pass vacuously)', () => {
      for (const name of ['--border', '--input', '--brand-border', '--danger-subtle']) {
        expect(translucent.has(name), name).toBe(true);
      }
    });

    it('--popover and the ink/status tokens a toast mixes are opaque in both themes', () => {
      for (const name of [
        '--popover',
        '--popover-foreground',
        '--foreground',
        '--muted-foreground',
        '--danger',
        '--info',
        '--success',
        '--warning',
        '--danger-subtle-foreground',
        '--info-subtle-foreground',
        '--success-subtle-foreground',
        '--warning-subtle-foreground',
      ]) {
        expect(LIGHT.has(name), `${name} missing in :root`).toBe(true);
        expect(DARK.has(name) || LIGHT.has(name), name).toBe(true);
        expect(translucent.has(name), `${name} is translucent`).toBe(false);
      }
    });

    it('no toast surface references a translucent token or alpha/transparent', () => {
      for (const [key, value] of Object.entries(el.props.style)) {
        expect(value, key).not.toMatch(/\btransparent\b|\/\s*[\d.]+%?\s*\)/);
        for (const ref of value.matchAll(/var\((--[\w-]+)/g)) {
          expect(translucent.has(ref[1]), `${key}: ${value} uses translucent ${ref[1]}`).toBe(
            false,
          );
        }
      }
    });

    it('every mix is anchored on --popover, so its alpha is 1', () => {
      for (const [key, value] of Object.entries(el.props.style)) {
        if (value.startsWith('color-mix(')) {
          expect(value, key).toMatch(/, var\(--popover\)\)$/);
        }
      }
    });
  });

  it('lifts above the docked bulk bar below md, from the measured bar height', () => {
    expect(el.props.className).toContain('bulk-action-bar');
    expect(el.props.className).toContain(':max-md:');
    expect(el.props.className).not.toContain('max-[600px]');
    expect(el.props.className).toContain('var(--bulk-bar-height');
    expect(el.props.className).toMatch(/!$/);
  });
});
