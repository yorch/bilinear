/**
 * Accent colour preference.
 *
 * The accent is user-selectable (sidebar footer, workspace settings, command
 * palette). It is persisted in the `accent` cookie rather than localStorage so
 * the root layout can stamp `data-accent` on `<html>` during SSR — that is what
 * keeps first paint from flashing the wrong colour, and it mirrors how the
 * locale preference already works (see src/lib/i18n).
 *
 * Every accent declares only its hue and two gradient stops; globals.css
 * derives the whole neutral ramp and every other brand role from those. Adding
 * a fourth accent means one entry here plus one four-line block in globals.css.
 */

export const accents = ['aurora', 'ion', 'ultraviolet'] as const;
export type Accent = (typeof accents)[number];

export const defaultAccent: Accent = 'aurora';

export const ACCENT_COOKIE = 'accent';

/** One year, matching the locale cookie. */
export const ACCENT_COOKIE_MAX_AGE = 31536000;

export interface AccentDefinition {
  id: Accent;
  /** i18n key for the human-readable name. */
  labelKey: string;
  /**
   * The two gradient stops, as `var()` references into globals.css.
   *
   * These are deliberately NOT `var(--brand)` / `var(--brand-2)`: the picker
   * renders every option at once, so each swatch needs its own fixed colour
   * rather than the active accent's. Referencing a custom property instead of
   * inlining hex keeps `yarn lint:tokens` at its zero baseline — the same
   * approach already used for PRIORITY_CONFIG and CURSOR_COLORS.
   */
  swatch: readonly [string, string];
}

export const ACCENT_DEFINITIONS: readonly AccentDefinition[] = [
  {
    id: 'aurora',
    labelKey: 'accent.aurora',
    swatch: ['var(--swatch-aurora-1)', 'var(--swatch-aurora-2)'],
  },
  {
    id: 'ion',
    labelKey: 'accent.ion',
    swatch: ['var(--swatch-ion-1)', 'var(--swatch-ion-2)'],
  },
  {
    id: 'ultraviolet',
    labelKey: 'accent.ultraviolet',
    swatch: ['var(--swatch-ultraviolet-1)', 'var(--swatch-ultraviolet-2)'],
  },
] as const;

export function isAccent(value: string | undefined | null): value is Accent {
  return !!value && (accents as readonly string[]).includes(value);
}

/** CSS `linear-gradient` for an accent's swatch, for inline `style` use. */
export function accentSwatchGradient(definition: AccentDefinition): string {
  return `linear-gradient(135deg, ${definition.swatch[0]}, ${definition.swatch[1]})`;
}
