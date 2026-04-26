'use client';

import { getPriorityConfig } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';

interface PriorityIconProps {
  className?: string;
  priority: number;
}

export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const config = getPriorityConfig(priority);
  return (
    <span
      className={cn('font-mono text-xs leading-none', className)}
      style={{ color: config.color }}
      title={config.label}
    >
      {config.icon}
    </span>
  );
}
