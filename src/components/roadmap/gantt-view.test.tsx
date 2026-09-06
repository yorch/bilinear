import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GanttView, shiftRange } from './gantt-view';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params?.name ? `${key}:${params.name}` : key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ dateFnsLocale: undefined }),
}));

const d = (iso: string) => {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
};

describe('shiftRange', () => {
  it('moves both ends together', () => {
    const { end, start } = shiftRange('move', d('2026-03-02'), d('2026-03-10'), 3);
    expect([start, end]).toEqual([d('2026-03-05'), d('2026-03-13')]);
  });

  it('never lets a resized start cross the end, nor a resized end cross the start', () => {
    expect(shiftRange('resize-start', d('2026-03-02'), d('2026-03-10'), 20).start).toEqual(
      d('2026-03-10'),
    );
    expect(shiftRange('resize-end', d('2026-03-02'), d('2026-03-10'), -20).end).toEqual(
      d('2026-03-02'),
    );
  });

  it('keeps a missing side missing', () => {
    expect(shiftRange('move', null, d('2026-03-10'), 1)).toEqual({
      end: d('2026-03-11'),
      start: null,
    });
  });
});

describe('GanttView keyboard nudge', () => {
  const item = { endDate: '2026-03-10', id: 'p1', name: 'Alpha', startDate: '2026-03-02' };

  it('moves the focused bar one day with the arrow keys', () => {
    const onChange = vi.fn();
    render(<GanttView items={[item]} onChange={onChange} />);
    const bar = screen.getByRole('button', { name: 'roadmap.gantt.dragBar:Alpha' });
    expect(bar).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('p1', '2026-03-03', '2026-03-11');

    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('p1', '2026-03-01', '2026-03-09');
  });

  it('ignores other keys', () => {
    const onChange = vi.fn();
    render(<GanttView items={[item]} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'roadmap.gantt.dragBar:Alpha' }), {
      key: 'Enter',
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
