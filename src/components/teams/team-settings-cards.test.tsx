import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DBWorkflowState } from '@/lib/db';
import { AutoCloseCard, CyclesCard, DefaultStateField } from './team-settings-cards';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

const noop = () => {};

function renderCycles(cyclesEnabled: boolean, onCycleStartDayChange = noop as (v: number) => void) {
  return render(
    <CyclesCard
      cycleCooldownTime="1"
      cycleDuration="2"
      cycleStartDay={1}
      cyclesEnabled={cyclesEnabled}
      onCycleCooldownTimeChange={noop}
      onCycleDurationChange={noop}
      onCycleStartDayChange={onCycleStartDayChange}
      onCyclesEnabledChange={noop}
    />,
  );
}

describe('CyclesCard', () => {
  it('hides the duration, start day and cooldown knobs while cycles are off', () => {
    renderCycles(false);
    expect(screen.queryByLabelText('settings.team.cycles.duration')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('settings.team.cycles.cooldown')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.team.cycles.startDay')).not.toBeInTheDocument();
  });

  it('shows them once enabled, seeded from the props', () => {
    renderCycles(true);
    expect(screen.getByLabelText('settings.team.cycles.duration')).toHaveValue(2);
    expect(screen.getByLabelText('settings.team.cycles.cooldown')).toHaveValue(1);
    expect(screen.getByText('settings.team.cycles.weekdays.1')).toBeInTheDocument();
  });

  it('emits the weekday as a number', () => {
    const onChange = vi.fn();
    renderCycles(true, onChange);
    fireEvent.click(screen.getByText('settings.team.cycles.weekdays.1'));
    fireEvent.click(screen.getByRole('option', { name: 'settings.team.cycles.weekdays.0' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe('AutoCloseCard', () => {
  it('renders both cascade toggles and reports changes', () => {
    const onChild = vi.fn();
    const onParent = vi.fn();
    render(
      <AutoCloseCard
        autoArchivePeriod=""
        autoCloseChildIssues={false}
        autoCloseParentIssues={true}
        autoClosePeriod="6"
        onAutoArchivePeriodChange={noop}
        onAutoCloseChildIssuesChange={onChild}
        onAutoCloseParentIssuesChange={onParent}
        onAutoClosePeriodChange={noop}
      />,
    );
    const child = screen.getByRole('switch', { name: /childIssues/ });
    const parent = screen.getByRole('switch', { name: /parentIssues/ });
    expect(child).toHaveAttribute('aria-checked', 'false');
    expect(parent).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(child);
    expect(onChild).toHaveBeenCalledWith(true);
    fireEvent.click(parent);
    expect(onParent).toHaveBeenCalledWith(false);
  });
});

describe('DefaultStateField', () => {
  const states = [
    { color: 'var(--info)', id: 'backlog', name: 'Backlog', position: 1 },
    { color: 'var(--info)', id: 'todo', name: 'Todo', position: 2 },
  ] as DBWorkflowState[];

  it('offers the server default plus every team state and emits the chosen id', () => {
    const onChange = vi.fn();
    render(<DefaultStateField onChange={onChange} states={states} value="backlog" />);
    fireEvent.click(screen.getByText('Backlog'));
    const options = screen.getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['settings.team.defaultState.serverDefault', 'Backlog', 'Todo']);
    fireEvent.click(screen.getByRole('option', { name: 'Todo' }));
    expect(onChange).toHaveBeenCalledWith('todo');
  });
});
