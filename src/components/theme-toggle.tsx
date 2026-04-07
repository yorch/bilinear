'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { icon: Sun, label: 'Light', value: 'light' as const },
  { icon: Moon, label: 'Dark', value: 'dark' as const },
  { icon: Monitor, label: 'System', value: 'system' as const },
];

interface ThemeToggleProps {
  className?: string;
}

/**
 * Three-way toggle: Light / Dark / System.
 * Rendered inside the sidebar footer.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { setTheme, theme } = useTheme();

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
