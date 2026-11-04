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

  it('resizes the end with Shift+Arrow and the start with Shift+Alt+Arrow', () => {
    const onChange = vi.fn();
    render(<GanttView items={[item]} onChange={onChange} />);
    const bar = screen.getByRole('button', { name: 'roadmap.gantt.dragBar:Alpha' });

    fireEvent.keyDown(bar, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('p1', '2026-03-02', '2026-03-11');

    fireEvent.keyDown(bar, { altKey: true, key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('p1', '2026-03-01', '2026-03-10');
  });

  it('keeps resize handles out of the tab order and inert to arrow keys', () => {
    const onChange = vi.fn();
    render(<GanttView items={[item]} onChange={onChange} />);
    for (const name of ['roadmap.gantt.resizeStart', 'roadmap.gantt.resizeEnd']) {
      const handle = screen.getByRole('button', { name });
      expect(handle).toHaveAttribute('tabindex', '-1');
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes the name and dates as a tooltip and never forces white ink', () => {
    render(<GanttView items={[item]} />);
    const bar = screen.getByRole('button', { name: 'roadmap.gantt.dragBar:Alpha' });
    expect(bar).toHaveAttribute('title', 'Alpha (2026-03-02 – 2026-03-10)');
    expect(bar.className).not.toContain('text-white');
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

describe('GanttView dates', () => {
  it('positions bars from ISO timestamps, not "today"', () => {
    const onChange = vi.fn();
    render(
      <GanttView
        items={[
          {
            endDate: '2026-10-27T00:00:00.000Z',
            id: 'iso',
            name: 'Iso',
            startDate: '2026-10-20T00:00:00.000Z',
          },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'roadmap.gantt.dragBar:Iso' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenLastCalledWith('iso', '2026-10-21', '2026-10-28');
  });

  it('nudging a one-sided bar moves only the date that exists', () => {
    const onChange = vi.fn();
    render(
      <GanttView
        items={[{ endDate: '2026-10-27T00:00:00.000Z', id: 'one', name: 'One', startDate: null }]}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'roadmap.gantt.dragBar:One' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenLastCalledWith('one', null, '2026-10-28');
  });

  it('never persists invented dates for a bar with no dates', () => {
    const onChange = vi.fn();
    render(
      <GanttView
        items={[{ endDate: null, id: 'none', name: 'None', startDate: null }]}
        onChange={onChange}
      />,
    );
    const bar = screen.getByRole('button', { name: 'roadmap.gantt.dragBar:None' });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    fireEvent.pointerDown(bar, { clientX: 10 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    expect(onChange).not.toHaveBeenCalled();
  });
});
