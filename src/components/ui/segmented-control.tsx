import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SegmentedOption<T extends string> {
  /** Screen-reader name, for segments whose label is icon-led. */
  ariaLabel?: string;
  label: ReactNode;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** `sm` for text-only segments (default), `md` where segments carry an icon. */
  size?: keyof typeof SEGMENT_PADDING;
  value: T;
}

const SEGMENT_PADDING = {
  md: 'px-2 py-1',
  sm: 'px-2 py-0.5',
} as const;

/**
 * A small bordered segmented toggle: the selected segment gets a `bg-muted`
 * pill, the rest are muted text. Used by the analytics sections and the
 * projects list/roadmap switch.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: SegmentedControlProps<T>) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map(opt => (
        <button
          aria-label={opt.ariaLabel}
          aria-pressed={value === opt.value}
          className={cn(
            'flex items-center gap-1 rounded text-xs transition-colors',
            SEGMENT_PADDING[size],
            value === opt.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={opt.value}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
