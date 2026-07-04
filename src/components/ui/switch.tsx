'use client';

import { cn } from '@/lib/utils';

interface SwitchProps {
  'aria-label'?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * iOS-style toggle. Replaces the hand-rolled `role="switch"` buttons that
 * were re-implemented per settings page with drifting colors and focus rings.
 */
export function Switch({
  'aria-label': ariaLabel,
  checked,
  className,
  disabled,
  id,
  onCheckedChange,
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900',
        checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
