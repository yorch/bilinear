import { cn } from '@/lib/utils';

const DOT_SIZES = {
  md: 'h-2.5 w-2.5',
  sm: 'h-2 w-2',
} as const;

interface ColorDotProps {
  className?: string;
  color: string;
  /** `sm` = 8px (labels), `md` = 10px (workflow states). Defaults to `md`. */
  size?: keyof typeof DOT_SIZES;
  /** Tooltip for dots that carry meaning on their own (priority, label swatches). */
  title?: string;
}

/**
 * A small solid-colour dot: label and workflow-state swatches, priority dots,
 * chart legend keys. Backs `StatusDot`/`LabelDot`, which differed only in
 * diameter. The colour is entity data from the database, so it stays an inline
 * style — it can never be a design token.
 */
export function ColorDot({ color, size = 'md', className, title }: ColorDotProps) {
  return (
    <span
      className={cn('inline-block flex-shrink-0 rounded-full', DOT_SIZES[size], className)}
      style={{ backgroundColor: color }}
      title={title}
    />
  );
}
