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
    <div className="flex items-center rounded-md border border-border">
      <button
        className={cn(
          'flex items-center justify-center rounded-l-md px-2 py-1 transition-colors max-md:h-11 max-md:min-w-11',
          mode === 'list'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground-secondary',
        )}
        onClick={() => onChange('list')}
        title={t('issues.listViewShortcut')}
        type="button"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        className={cn(
          'flex items-center justify-center px-2 py-1 transition-colors max-md:h-11 max-md:min-w-11',
          mode === 'board'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground-secondary',
        )}
        onClick={() => onChange('board')}
        title={t('issues.boardViewShortcut')}
        type="button"
      >
        <Kanban className="h-4 w-4" />
      </button>
      <button
        className={cn(
          'flex items-center justify-center rounded-r-md px-2 py-1 transition-colors max-md:h-11 max-md:min-w-11',
          mode === 'timeline'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground-secondary',
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
