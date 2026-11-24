import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriageSnoozeMenu } from './triage-snooze-menu';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

function open(props: Partial<React.ComponentProps<typeof TriageSnoozeMenu>> = {}) {
  const onSelect = vi.fn();
  render(<TriageSnoozeMenu disabled={false} onSelect={onSelect} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /settings\.triage\.snooze$/ }));
  return onSelect;
}

describe('TriageSnoozeMenu', () => {
  it('lists the three presets as options and reports the chosen hours', () => {
    const onSelect = open();
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'settings.triage.snooze4Hours',
      'settings.triage.snooze1Day',
      'settings.triage.snooze1Week',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'settings.triage.snooze1Day' }));
    expect(onSelect).toHaveBeenCalledWith(24);
    // Choosing closes the panel.
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('keeps the same DOM nodes across re-renders (no remount churn)', () => {
    const { rerender } = render(<TriageSnoozeMenu disabled={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    const before = screen.getAllByRole('option');
    rerender(<TriageSnoozeMenu disabled={false} onSelect={vi.fn()} />);
    const after = screen.getAllByRole('option');
    after.forEach((node, i) => {
      expect(node).toBe(before[i]);
    });
  });

  it('claims Escape: closes the menu and stops the event reaching other listeners', () => {
    open();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(screen.queryByRole('option')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('moves focus between options with the arrow keys', () => {
    open();
    const options = screen.getAllByRole('option');
    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
  });

  it('opens once when forceOpen is set (the H / S shortcut)', () => {
    render(<TriageSnoozeMenu disabled={false} forceOpen onSelect={vi.fn()} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});
