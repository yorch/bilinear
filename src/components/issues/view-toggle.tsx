'use client';

import { GanttChartSquare, Kanban, List } from 'lucide-react';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';

export type ViewMode = 'list' | 'board' | 'timeline';

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  const t = useTranslations();
  return (
    <fieldset
      aria-label={t('issues.viewLayout')}
      className="flex items-center rounded-md border border-border"
    >
      <button
        aria-label={t('issues.listViewShortcut')}
        aria-pressed={mode === 'list'}
        className={cn(
          'flex items-center justify-center rounded-l-md px-2 py-1 transition-colors',
          TOUCH_TARGET,
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
        aria-label={t('issues.boardViewShortcut')}
        aria-pressed={mode === 'board'}
        className={cn(
          'flex items-center justify-center px-2 py-1 transition-colors',
          TOUCH_TARGET,
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
        aria-label={t('issues.timelineViewShortcut')}
        aria-pressed={mode === 'timeline'}
        className={cn(
          'flex items-center justify-center rounded-r-md px-2 py-1 transition-colors',
          TOUCH_TARGET,
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
    </fieldset>
  );
}
