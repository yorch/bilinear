'use client';

import { Kanban, List } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewMode = 'list' | 'board';

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-md border border-zinc-200 dark:border-zinc-700">
      <button
        className={cn(
          'flex items-center justify-center rounded-l-md px-2 py-1 transition-colors',
          mode === 'list'
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
            : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300',
        )}
        onClick={() => onChange('list')}
        title="List view (Alt+1)"
        type="button"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        className={cn(
          'flex items-center justify-center rounded-r-md px-2 py-1 transition-colors',
          mode === 'board'
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
            : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300',
        )}
        onClick={() => onChange('board')}
        title="Board view (Alt+2)"
        type="button"
      >
        <Kanban className="h-4 w-4" />
      </button>
    </div>
  );
}
