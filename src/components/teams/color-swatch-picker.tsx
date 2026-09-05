'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The fixed entity palette declared in `globals.css` (`--entity-swatch-N`).
 * Referenced by var() name here so no hex literal lives in TSX; the hex is
 * resolved from the stylesheet at pick time because the chosen colour is
 * persisted on the entity (label / state / team) as plain data.
 */
export const ENTITY_SWATCH_VARS: readonly string[] = Array.from(
  { length: 10 },
  (_, i) => `--entity-swatch-${i + 1}`,
);

/** Resolve a CSS custom property to its computed value, or `null` off-DOM. */
export function resolveCssVar(name: string): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || null;
}

interface ColorSwatchPickerProps {
  'aria-label': string;
  className?: string;
  onChange: (hex: string) => void;
  value: string;
}

/**
 * Palette of token-backed swatches plus a native colour input for anything
 * off-palette. Emits a hex string. Highlights the swatch whose resolved value
 * matches `value` (case-insensitive) so a saved palette colour reads as
 * "selected" when the form reopens.
 */
export function ColorSwatchPicker({
  'aria-label': ariaLabel,
  className,
  onChange,
  value,
}: ColorSwatchPickerProps) {
  const current = value.toLowerCase();
  return (
    <fieldset
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-1.5 border-0 p-0 m-0', className)}
    >
      {ENTITY_SWATCH_VARS.map(varName => {
        const resolved = resolveCssVar(varName);
        const selected = resolved !== null && resolved.toLowerCase() === current;
        return (
          <button
            aria-label={varName}
            aria-pressed={selected}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full border border-transparent transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'border-foreground',
            )}
            key={varName}
            onClick={() => onChange(resolved ?? `var(${varName})`)}
            style={{ backgroundColor: `var(${varName})` }}
            type="button"
          >
            {selected && <Check aria-hidden="true" className="h-3 w-3 text-primary-foreground" />}
          </button>
        );
      })}
      <input
        aria-label={`${ariaLabel} (custom)`}
        className="h-5 w-7 cursor-pointer rounded border border-input bg-transparent p-0"
        onChange={e => onChange(e.target.value)}
        type="color"
        // A native colour input refuses '' with a console warning, so an
        // entity with no colour yet shows the first palette swatch instead
        // of an invalid value. Resolved from the stylesheet like the swatches.
        value={
          /^#[0-9a-f]{6}$/i.test(value)
            ? value
            : (resolveCssVar(ENTITY_SWATCH_VARS[0] ?? '') ?? value)
        }
      />
    </fieldset>
  );
}
