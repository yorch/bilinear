import { describe, expect, it } from 'vitest';
import { Toaster } from './toast';

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

  it('keeps every toast surface fully opaque: fills and borders are --popover or a mix onto it', () => {
    const surfaces = Object.entries(el.props.style).filter(([k]) => /-(bg|border)$/.test(k));
    // 5 variants (error, info, normal, success, warning) x fill + border.
    expect(surfaces).toHaveLength(10);
    for (const [key, value] of surfaces) {
      const opaque =
        value === 'var(--popover)' ||
        /^color-mix\(in oklab, var\(--[a-z-]+\) \d+%, var\(--popover\)\)$/.test(value);
      expect(opaque, `${key}: ${value}`).toBe(true);
      // Translucent tokens/keywords would let list rows show through the toast.
      expect(value).not.toMatch(
        /transparent|-subtle(?!-foreground)|var\(--border\)|var\(--(?:accent|muted)\)|\/\s*[\d.]+%?\s*\)/,
      );
    }
  });

  it('lifts above the docked bulk bar on phones', () => {
    expect(el.props.className).toContain('bulk-action-bar');
  });
});
