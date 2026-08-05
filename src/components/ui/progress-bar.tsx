import { cn } from '@/lib/utils';

interface ProgressBarProps {
  /** Track sizing / layout classes, e.g. "h-2", "h-1.5 w-16", "mt-2 h-2". */
  className?: string;
  /**
   * Override the fill colour/animation (defaults to the brand fill). The
   * sub-issue completion bar is the one caller that uses it, for `bg-success`.
   */
  fillClassName?: string;
  /** Completion percentage, 0–100. */
  value: number;
}

/**
 * Horizontal progress track + fill, shared by the project/cycle detail and
 * list views, the public roadmap and the sub-issue completion bar. Pass the
 * track height/width via `className`; the fill defaults to `bg-brand`.
 */
export function ProgressBar({ value, className, fillClassName }: ProgressBarProps) {
  return (
    <div className={cn('overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn('h-full rounded-full bg-brand transition-all', fillClassName)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
