import { act, fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootStore } from '@/stores/root-store';

const { enqueue, storeHolder } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  storeHolder: {} as { current: RootStore },
}));

vi.mock('@/lib/transaction-queue', () => ({
  TransactionQueue: vi.fn().mockImplementation(function TransactionQueueMock() {
    return { enqueue };
  }),
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, p?: Record<string, string>) =>
    p?.when ? `${key}|${p.when}` : key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatDateTime: (v: string | Date) => `@${new Date(v).toISOString()}` }),
}));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));

const { IssueReminderChip } = await import('./issue-reminder-chip');

const NOW = new Date('2026-11-24T12:00:00Z');
const row = (remindAt: string) => ({
  createdAt: '2026-11-24T00:00:00Z',
  id: 'r1',
  issueId: 'i1',
  organizationId: 'org',
  remindAt,
  updatedAt: '2026-11-24T00:00:00Z',
  userId: 'me',
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  storeHolder.current = new RootStore();
  enqueue.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('IssueReminderChip', () => {
  it('renders nothing without a reminder', () => {
    render(<IssueReminderChip issueId="i1" />);
    expect(screen.queryByTestId('issue-reminder-chip')).toBeNull();
  });

  it('shows visible "Reminder: <when>" text and a labelled clear button', () => {
    runInAction(() =>
      storeHolder.current.issueReminderStore.applySyncAction(
        'I',
        'r1',
        row('2026-11-25T09:00:00Z'),
      ),
    );
    render(<IssueReminderChip issueId="i1" />);

    const chip = screen.getByTestId('issue-reminder-chip');
    expect(chip.textContent).toContain('reminders.chipLabel|@2026-11-25T09:00:00.000Z');
    const clear = screen.getByTestId('issue-reminder-clear');
    expect(clear.getAttribute('aria-label')).toContain('reminders.clear');
    // Touch target comes from the shared constant, not a 16px hit area.
    expect(clear.className).toContain('max-md:h-11');
  });

  it('appears live when a sync action for the viewer arrives (second tab)', () => {
    render(<IssueReminderChip issueId="i1" />);
    expect(screen.queryByTestId('issue-reminder-chip')).toBeNull();
    act(() =>
      storeHolder.current.issueReminderStore.applySyncAction(
        'I',
        'r1',
        row('2026-11-25T09:00:00Z'),
      ),
    );
    expect(screen.getByTestId('issue-reminder-chip')).toBeTruthy();
  });

  it('vanishes when the sweep deletes it (sync D) ...', () => {
    runInAction(() =>
      storeHolder.current.issueReminderStore.applySyncAction(
        'I',
        'r1',
        row('2026-11-25T09:00:00Z'),
      ),
    );
    render(<IssueReminderChip issueId="i1" />);
    act(() => storeHolder.current.issueReminderStore.applySyncAction('D', 'r1', null));
    expect(screen.queryByTestId('issue-reminder-chip')).toBeNull();
  });

  it('... and hides itself at the reminder time even if no delete ever arrives', () => {
    runInAction(() =>
      storeHolder.current.issueReminderStore.applySyncAction(
        'I',
        'r1',
        row('2026-11-24T12:00:30Z'),
      ),
    );
    render(<IssueReminderChip issueId="i1" />);
    expect(screen.getByTestId('issue-reminder-chip')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.queryByTestId('issue-reminder-chip')).toBeNull();
  });

  it('does not render an already-past reminder', () => {
    runInAction(() =>
      storeHolder.current.issueReminderStore.applySyncAction(
        'I',
        'r1',
        row('2026-11-24T11:00:00Z'),
      ),
    );
    render(<IssueReminderChip issueId="i1" />);
    expect(screen.queryByTestId('issue-reminder-chip')).toBeNull();
  });

  it('clear removes the chip immediately and queues the clear mutation', () => {
    runInAction(() =>
      storeHolder.current.issueReminderStore.applySyncAction(
        'I',
        'r1',
        row('2026-11-25T09:00:00Z'),
      ),
    );
    render(<IssueReminderChip issueId="i1" />);
    fireEvent.click(screen.getByTestId('issue-reminder-clear'));
    expect(screen.queryByTestId('issue-reminder-chip')).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toEqual({ issueId: 'i1' });
  });
});
