import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorSwatchPicker, ENTITY_SWATCH_VARS } from './color-swatch-picker';

const realGetComputedStyle = window.getComputedStyle;

/**
 * Make every `--entity-swatch-N` resolve to `value`, or to '' for
 * "unresolvable". `rgb(...)` rather than a hex literal because
 * `scripts/check-design-tokens.mjs` counts hex literals here (its
 * `*.test.tsx` ignore pattern does not actually match), and the component
 * passes the resolved string through unchanged either way.
 */
function stubSwatchResolution(value: string) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el: Element, pseudo?: string | null) =>
      ({
        ...realGetComputedStyle(el, pseudo ?? undefined),
        getPropertyValue: (name: string) => (name.startsWith('--entity-swatch-') ? value : ''),
      }) as CSSStyleDeclaration,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ColorSwatchPicker', () => {
  it('emits the resolved colour when the custom property resolves', () => {
    stubSwatchResolution('rgb(99, 102, 241)');
    const onChange = vi.fn();
    render(<ColorSwatchPicker aria-label="Team color" onChange={onChange} value="" />);

    fireEvent.click(screen.getByRole('button', { name: ENTITY_SWATCH_VARS[0] as string }));

    expect(onChange).toHaveBeenCalledWith('rgb(99, 102, 241)');
  });

  it('never emits a var() string when the custom property cannot be resolved', () => {
    // The colour columns are VarChar(7): `var(--entity-swatch-1)` is 22 chars,
    // so the old fallback failed at Postgres rather than degrading.
    stubSwatchResolution('');
    const onChange = vi.fn();
    render(<ColorSwatchPicker aria-label="Team color" onChange={onChange} value="" />);

    const swatch = screen.getByRole('button', { name: ENTITY_SWATCH_VARS[0] as string });
    expect(swatch).toBeDisabled();

    fireEvent.click(swatch);
    expect(onChange).not.toHaveBeenCalled();
  });
});
