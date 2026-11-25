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

  it('lifts above the docked bulk bar on phones', () => {
    expect(el.props.className).toContain('bulk-action-bar');
  });
});
