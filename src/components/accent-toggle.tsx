'use client';

import { useTranslations } from '@/hooks/use-translations';
import { ACCENT_DEFINITIONS, type Accent, accentSwatchGradient } from '@/lib/accent';
import { cn } from '@/lib/utils';
import { useAccent } from '@/providers/accent-provider';

interface AccentToggleProps {
  className?: string;
  /** Render a single swatch button that cycles through accents. For compact spaces (e.g. collapsed sidebar). */
  compact?: boolean;
}

/**
 * Accent colour picker: Aurora / Ion / Ultraviolet.
 * Pass `compact` to render a single cycling swatch button instead.
 *
 * Unlike `ThemeToggle` and `LanguageToggle` this needs no `mounted` guard —
 * the accent is resolved from a cookie during SSR and stamped on `<html>` by
 * the root layout, so the server and client agree on first render.
 */
export function AccentToggle({ className, compact = false }: AccentToggleProps) {
  const { accent, setAccent } = useAccent();
  const t = useTranslations();

  const current = ACCENT_DEFINITIONS.find(a => a.id === accent) ?? ACCENT_DEFINITIONS[0];
  const label = (id: Accent) =>
    t(ACCENT_DEFINITIONS.find(a => a.id === id)?.labelKey ?? 'accent.aurora');

  if (compact) {
    const currentIndex = ACCENT_DEFINITIONS.findIndex(a => a.id === accent);
    const next = ACCENT_DEFINITIONS[(currentIndex + 1) % ACCENT_DEFINITIONS.length];
    return (
      <button
        aria-label={t('accent.currentAccent', { accent: label(current.id) })}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted',
          className,
        )}
        onClick={() => setAccent(next.id)}
        title={t('accent.currentAccent', { accent: label(current.id) })}
        type="button"
      >
        <span
          className="h-3.5 w-3.5 rounded-full ring-1 ring-border"
          style={{ backgroundImage: accentSwatchGradient(current) }}
        />
      </button>
    );
  }

  return (
    <fieldset
      className={cn('flex items-center gap-0.5 rounded-md bg-muted p-0.5 border-0 m-0', className)}
    >
      <legend className="sr-only">{t('accent.accent')}</legend>
      {ACCENT_DEFINITIONS.map(definition => (
        <button
          aria-pressed={accent === definition.id}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors max-md:h-11 max-md:w-11',
            accent === definition.id ? 'bg-surface-raised shadow-sm' : 'hover:bg-accent',
          )}
          key={definition.id}
          onClick={() => setAccent(definition.id)}
          title={t(definition.labelKey)}
          type="button"
        >
          <span
            className={cn(
              'h-3.5 w-3.5 rounded-full transition-shadow',
              accent === definition.id
                ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface-raised'
                : 'ring-1 ring-border',
            )}
            style={{ backgroundImage: accentSwatchGradient(definition) }}
          />
        </button>
      ))}
    </fieldset>
  );
}
