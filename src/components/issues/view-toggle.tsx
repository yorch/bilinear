'use client';

import { GanttChartSquare, Kanban, List } from 'lucide-react';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

export type ViewMode = 'list' | 'board' | 'timeline';

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  const t = useTranslations();
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
        title={t('issues.listViewShortcut')}
        type="button"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        className={cn(
          'flex items-center justify-center px-2 py-1 transition-colors',
          mode === 'board'
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
            : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300',
        )}
        onClick={() => onChange('board')}
        title={t('issues.boardViewShortcut')}
        type="button"
      >
        <Kanban className="h-4 w-4" />
      </button>
      <button
        className={cn(
          'flex items-center justify-center rounded-r-md px-2 py-1 transition-colors',
          mode === 'timeline'
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
            : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300',
        )}
        onClick={() => onChange('timeline')}
        title={t('issues.timelineViewShortcut')}
        type="button"
      >
        <GanttChartSquare className="h-4 w-4" />
      </button>
    </div>
  );
}
