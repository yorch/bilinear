import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ALL_GROUP_OPTIONS, ListDisplayControls } from './list-display-controls';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderControls(props: Partial<React.ComponentProps<typeof ListDisplayControls>> = {}) {
  const handlers = { onCompleted: vi.fn(), onGroupBy: vi.fn(), onOrderBy: vi.fn() };
  render(
    <ListDisplayControls
      completed="all"
      groupBy="status"
      groupOptions={ALL_GROUP_OPTIONS}
      orderBy="manual"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('ListDisplayControls', () => {
  it('offers project, cycle and label grouping in the mobile Display panel', () => {
    renderControls();
    const menu = screen.getByTestId('display-menu');
    fireEvent.click(menu.querySelector('button') as HTMLElement);
    expect(screen.getAllByText('issues.groupByProject').length).toBeGreaterThan(0);
    expect(screen.getAllByText('issues.groupByCycle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('issues.groupByLabelOption').length).toBeGreaterThan(0);
  });

  it('picks a completed-issues mode from the Display panel', () => {
    const { onCompleted } = renderControls();
    fireEvent.click(screen.getByTestId('display-menu').querySelector('button') as HTMLElement);
    fireEvent.click(screen.getByText('issues.completedPastWeek'));
    expect(onCompleted).toHaveBeenCalledWith('pastWeek');
  });

  it('omits the completed control when the page does not support it', () => {
    renderControls({ completed: undefined, onCompleted: undefined });
    fireEvent.click(screen.getByTestId('display-menu').querySelector('button') as HTMLElement);
    expect(screen.queryByText('issues.completedPastWeek')).toBeNull();
  });

  it('folds extra actions (export) into the Display panel', () => {
    renderControls({ mobileExtra: <span>export-action</span> });
    expect(screen.queryByText('export-action')).toBeNull();
    fireEvent.click(screen.getByTestId('display-menu').querySelector('button') as HTMLElement);
    expect(screen.getByText('export-action')).toBeTruthy();
  });
});
