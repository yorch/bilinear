'use client';

import { useTranslations } from '@/hooks/use-translations';
import { getPriorityConfig } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';

interface PriorityIconProps {
  className?: string;
  priority: number;
}

/** Maps priority numeric values to i18n keys under `properties.priority.*`. */
const PRIORITY_LABEL_KEYS: Record<number, string> = {
  0: 'properties.priority.noPriority',
  1: 'properties.priority.urgent',
  2: 'properties.priority.high',
  3: 'properties.priority.medium',
  4: 'properties.priority.low',
};

/**
 * Resolve a priority integer to its i18n key, falling back to "No priority" for
 * any out-of-range value. Pass the result to `t()`: `t(priorityLabelKey(p))`.
 */
export function priorityLabelKey(priority: number): string {
  return PRIORITY_LABEL_KEYS[priority] ?? PRIORITY_LABEL_KEYS[0];
}

/** Bottom-aligned bar geometry in the 16×16 viewBox, shortest first. */
const BARS = [
  { height: 5, x: 1.5, y: 9.5 },
  { height: 9, x: 6.5, y: 5.5 },
  { height: 13, x: 11.5, y: 1.5 },
] as const;

const BAR_WIDTH = 3;
const BAR_RADIUS = 1;

/**
 * Priority as a fixed-size glyph.
 *
 * Three ascending bars, filled up to the level — the shape alone carries the
 * meaning, so the ramp survives greyscale and colour-blindness (WCAG 1.4.1);
 * colour only reinforces it. Urgent breaks the ramp with a filled rounded
 * square, because it is a category rather than one more step, and "all three
 * bars in red" vs "all three bars in orange" is a colour-only distinction.
 *
 * Unfilled bars stay visible at low opacity rather than being omitted: an icon
 * that changes silhouette per level cannot be scanned down a column, and the
 * count of *filled* bars is the thing being read.
 *
 * Always renders into a square box (`h-4 w-4` by default) so the priority cell
 * is the same width on every row. Its predecessor rendered ASCII (`'!!!'`,
 * `'·'`) in a text span, which no `h-/w-` class could size.
 */
export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const t = useTranslations();
  const config = getPriorityConfig(priority);
  const label = t(priorityLabelKey(priority));

  return (
    // role="img" + aria-label, not aria-hidden: the icon is the only priority
    // affordance in some places (board card, sub-issue row), so hiding it would
    // leave a screen reader with no priority at all. <title> stays for the
    // native hover tooltip.
    <svg
      aria-label={label}
      className={cn('shrink-0', className ?? 'h-4 w-4')}
      fill="none"
      focusable="false"
      role="img"
      style={{ color: config.color }}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      {config.urgent ? (
        <>
          <rect fill="currentColor" height="13" rx="3" width="13" x="1.5" y="1.5" />
          {/* Fixed ink, not --card: the square is always --priority-urgent, so
              a surface-derived colour would make the glyph disappear the moment
              the row hovers onto a different surface. */}
          <rect
            fill="var(--priority-urgent-ink)"
            height="5.5"
            rx="0.75"
            width="1.75"
            x="7.125"
            y="3.75"
          />
          <rect
            fill="var(--priority-urgent-ink)"
            height="1.75"
            rx="0.75"
            width="1.75"
            x="7.125"
            y="10.5"
          />
        </>
      ) : (
        BARS.map((bar, i) => (
          <rect
            fill="currentColor"
            height={bar.height}
            key={bar.x}
            opacity={i < config.bars ? 1 : 0.25}
            rx={BAR_RADIUS}
            width={BAR_WIDTH}
            x={bar.x}
            y={bar.y}
          />
        ))
      )}
    </svg>
  );
}
