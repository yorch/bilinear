import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardControls } from './board-controls';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('BoardControls', () => {
  it('shows the current group-by and swimlane values', () => {
    render(
      <BoardControls
        groupBy="assignee"
        onGroupBy={() => {}}
        onSwimlaneBy={() => {}}
        swimlaneBy="none"
      />,
    );
    expect(screen.getByRole('button', { name: 'issues.groupByLabel' })).toHaveTextContent(
      'issues.groupByAssignee',
    );
    expect(screen.getByRole('button', { name: 'issues.swimlaneByLabel' })).toHaveTextContent(
      'issues.noSwimlanes',
    );
  });

  it('reports a chosen option through the matching callback', () => {
    const onGroupBy = vi.fn();
    const onSwimlaneBy = vi.fn();
    render(
      <BoardControls
        groupBy="status"
        onGroupBy={onGroupBy}
        onSwimlaneBy={onSwimlaneBy}
        swimlaneBy="none"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'issues.groupByLabel' }));
    fireEvent.click(screen.getByRole('option', { name: 'issues.groupByPriority' }));
    expect(onGroupBy).toHaveBeenCalledWith('priority');
    expect(onSwimlaneBy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'issues.swimlaneByLabel' }));
    fireEvent.click(screen.getByRole('option', { name: 'issues.swimlaneByAssignee' }));
    expect(onSwimlaneBy).toHaveBeenCalledWith('assignee');
  });
});
