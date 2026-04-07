'use client';

import { useTheme as useNextTheme } from 'next-themes';

export type Theme = 'light' | 'dark' | 'system';

/**
 * Thin wrapper around next-themes that exposes a typed API.
 * Persists to localStorage and applies the .dark class to <html>.
 */
export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useNextTheme();

  return {
    resolvedTheme: resolvedTheme as 'light' | 'dark' | undefined,
    setTheme: (t: Theme) => setTheme(t),
    theme: (theme ?? 'system') as Theme,
  };
}
