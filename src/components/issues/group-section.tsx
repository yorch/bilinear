'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { StatusDot } from '../properties/status-select';

interface GroupSectionProps {
  name: string;
  color: string;
  count: number;
  children: React.ReactNode;
}

export function GroupSection({
  name,
  color,
  count,
  children,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div data-testid="group-section">
      {/* Group header */}
      <button
        type="button"
        data-testid="group-header"
        className="flex w-full items-center gap-2 px-4 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        onClick={() => setCollapsed(c => !c)}
      >
        <span
          className={cn(
            'inline-block transition-transform',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
        >
          ▾
        </span>
        <StatusDot color={color} />
        <span className="text-zinc-700 dark:text-zinc-300">{name}</span>
        <span className="text-zinc-400">{count}</span>
      </button>

      {/* Issues */}
      {!collapsed && children}
    </div>
  );
}
