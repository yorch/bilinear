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

export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const t = useTranslations();
  const config = getPriorityConfig(priority);
  const label = t(priorityLabelKey(priority));
  return (
    <span
      className={cn('font-mono text-xs leading-none', className)}
      style={{ color: config.color }}
      title={label}
    >
      {config.icon}
    </span>
  );
}
