'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { icon: Sun, key: 'theme.light', value: 'light' as const },
  { icon: Moon, key: 'theme.dark', value: 'dark' as const },
  { icon: Monitor, key: 'theme.system', value: 'system' as const },
];

const CYCLE: Record<string, 'light' | 'dark' | 'system'> = {
  dark: 'system',
  light: 'dark',
  system: 'light',
};

interface ThemeToggleProps {
  className?: string;
  /** Render a single icon button that cycles through themes. For compact spaces (e.g. collapsed sidebar). */
  compact?: boolean;
}

/**
 * Three-way toggle: Light / Dark / System.
 * Pass `compact` to render a single cycling icon button instead.
 */
export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const { setTheme, theme } = useTheme();
  const t = useTranslations();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (compact) {
    const current = mounted ? (OPTIONS.find(o => o.value === theme) ?? OPTIONS[2]) : OPTIONS[2];
    const Icon = current.icon;
    const label = t(current.key);
    return (
      <button
        aria-label={t('theme.currentTheme', { theme: label })}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
          className,
        )}
        onClick={() => setTheme(CYCLE[theme])}
        title={t('theme.currentTheme', { theme: label })}
        type="button"
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <fieldset
      className={cn(
        'flex items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800 border-0 m-0',
        className,
      )}
    >
      <legend className="sr-only">{t('theme.colorTheme')}</legend>
      {OPTIONS.map(({ icon: Icon, key, value }) => (
        <button
          aria-pressed={mounted ? theme === value : undefined}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            mounted && theme === value
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
          )}
          key={value}
          onClick={() => setTheme(value)}
          title={t(key)}
          type="button"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </fieldset>
  );
}
