'use client';

import type { BoardGroupBy, BoardSwimlaneBy } from '@/components/issues/board-view';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';

interface BoardControlsProps {
  groupBy: BoardGroupBy;
  onGroupBy: (value: BoardGroupBy) => void;
  onSwimlaneBy: (value: BoardSwimlaneBy) => void;
  swimlaneBy: BoardSwimlaneBy;
}

const GROUP_BY_VALUES: readonly BoardGroupBy[] = ['status', 'assignee', 'priority'];
const SWIMLANE_VALUES: readonly BoardSwimlaneBy[] = ['none', 'assignee', 'priority'];

/**
 * The board view's "group by" + "swimlane" pair, rendered in a page header's
 * action strip next to `ViewToggle`. Shared by the team page and My Issues —
 * it was two verbatim copies of native `<select>`s before.
 */
export function BoardControls({
  groupBy,
  onGroupBy,
  onSwimlaneBy,
  swimlaneBy,
}: BoardControlsProps) {
  const t = useTranslations();
  const groupOptions = GROUP_BY_VALUES.map(value => ({
    label: t(`issues.groupBy${value.charAt(0).toUpperCase()}${value.slice(1)}`),
    value,
  }));
  const swimlaneOptions = SWIMLANE_VALUES.map(value => ({
    label:
      value === 'none'
        ? t('issues.noSwimlanes')
        : t(`issues.swimlaneBy${value.charAt(0).toUpperCase()}${value.slice(1)}`),
    value,
  }));
  return (
    <>
      <SimpleSelect
        ariaLabel={t('issues.groupByLabel')}
        onChange={value => onGroupBy(value as BoardGroupBy)}
        options={groupOptions}
        value={groupBy}
        variant="ghost"
      />
      <SimpleSelect
        ariaLabel={t('issues.swimlaneByLabel')}
        onChange={value => onSwimlaneBy(value as BoardSwimlaneBy)}
        options={swimlaneOptions}
        value={swimlaneBy}
        variant="ghost"
      />
    </>
  );
}
