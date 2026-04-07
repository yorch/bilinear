'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { icon: Sun, label: 'Light', value: 'light' as const },
  { icon: Moon, label: 'Dark', value: 'dark' as const },
  { icon: Monitor, label: 'System', value: 'system' as const },
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

  if (compact) {
    const current = OPTIONS.find(o => o.value === theme) ?? OPTIONS[2];
    const Icon = current.icon;
    return (
      <button
        type="button"
        onClick={() => setTheme(CYCLE[theme])}
        title={`Theme: ${current.label} (click to cycle)`}
        aria-label={`Current theme: ${current.label}. Click to cycle.`}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
          className,
        )}
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
      <legend className="sr-only">Color theme</legend>
      {OPTIONS.map(({ icon: Icon, label, value }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          title={label}
          aria-pressed={theme === value}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            theme === value
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </fieldset>
  );
}
