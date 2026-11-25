import { fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootStore } from '@/stores/root-store';

const { enqueue, storeHolder, toastSuccess } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  storeHolder: {} as { current: RootStore },
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/transaction-queue', () => ({
  TransactionQueue: vi.fn().mockImplementation(function TransactionQueueMock() {
    return { enqueue };
  }),
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: toastSuccess } }));
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({
    formatDateTime: (v: string | Date) => new Date(v).toISOString(),
    intlLocale: 'en-US',
  }),
}));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));

const { IssueReminderPanel } = await import('./issue-reminder-panel');

// Wednesday 10:00 local.
const NOW = new Date(2026, 10, 25, 10, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  storeHolder.current = new RootStore();
  storeHolder.current.userStore.currentUserId = 'me';
  enqueue.mockReset();
  toastSuccess.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('IssueReminderPanel', () => {
  it('offers the three presets and queues the chosen one', () => {
    const onClose = vi.fn();
    render(<IssueReminderPanel issueId="i1" onClose={onClose} />);

    expect(screen.getByText('reminders.laterToday')).toBeTruthy();
    expect(screen.getByText('reminders.tomorrow')).toBeTruthy();
    expect(screen.getByText('reminders.nextWeek')).toBeTruthy();

    fireEvent.click(screen.getByText('reminders.tomorrow'));

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toEqual({
      issueId: 'i1',
      remindAt: new Date(2026, 10, 26, 9, 0).toISOString(),
    });
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('reminders.set');
  });

  it('the custom picker disables days outside [today, +1 year] and does NOT commit on pick', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    // Nov 2026: today is the 25th — the 24th is in the past.
    expect(
      (screen.getByRole('button', { name: /November 24, 2026/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /November 25, 2026/ }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /November 26, 2026/ }));
    fireEvent.change(screen.getByLabelText('calendar.time'), { target: { value: '08:30' } });

    expect(enqueue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'reminders.setCustom' }));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({
      remindAt: new Date(2026, 10, 26, 8, 30).toISOString(),
    });
  });

  it('Enter submits the form', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /November 26, 2026/ }));
    const input = screen.getByLabelText('calendar.time');
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({
      remindAt: new Date(2026, 10, 26, 9, 0).toISOString(),
    });
  });

  it('validates inline: a time earlier today disables Set and explains why', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    const set = screen.getByRole('button', { name: 'reminders.setCustom' }) as HTMLButtonElement;

    fireEvent.click(screen.getByRole('button', { name: /November 25, 2026/ }));
    fireEvent.change(screen.getByLabelText('calendar.time'), { target: { value: '09:00' } });
    expect(set.disabled).toBe(true);
    expect(screen.getByText('reminders.pastTime')).toBeTruthy();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('Escape abandons the picker without setting anything', () => {
    const onClose = vi.fn();
    render(<IssueReminderPanel issueId="i1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /November 26, 2026/ }));
    const input = screen.getByLabelText('calendar.time');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('prefills the picker with the current reminder and offers to clear it', () => {
    runInAction(() =>
      storeHolder.current.issueReminderStore.applySyncAction('I', 'r1', {
        createdAt: '2026-11-24T00:00:00Z',
        id: 'r1',
        issueId: 'i1',
        organizationId: 'org',
        remindAt: new Date(2026, 10, 30, 14, 15).toISOString(),
        updatedAt: '2026-11-24T00:00:00Z',
        userId: 'me',
      }),
    );
    const onClose = vi.fn();
    render(<IssueReminderPanel issueId="i1" onClose={onClose} />);

    expect((screen.getByLabelText('calendar.time') as HTMLInputElement).value).toBe('14:15');
    expect(
      screen
        .getByRole('button', { name: /November 30, 2026/ })
        .closest('td')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(screen.getByText('reminders.clear'));
    expect(enqueue.mock.calls[0]?.[1]).toEqual({ issueId: 'i1' });
    expect(onClose).toHaveBeenCalled();
  });

  it('has no clear item when nothing is set', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    expect(screen.queryByText('reminders.clear')).toBeNull();
  });

  it('clearing the time keeps the chosen day and Set recovers once a time is typed', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    const day = () => screen.getByRole('button', { name: /November 26, 2026/ });
    const set = screen.getByRole('button', { name: 'reminders.setCustom' }) as HTMLButtonElement;
    fireEvent.click(day());
    fireEvent.change(screen.getByLabelText('calendar.time'), { target: { value: '' } });

    expect(day().closest('td')?.getAttribute('aria-selected')).toBe('true');
    expect(set.disabled).toBe(true);
    expect(screen.getByText('reminders.invalidTime')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('calendar.time'), { target: { value: '07:45' } });
    fireEvent.click(set);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({
      remindAt: new Date(2026, 10, 26, 7, 45).toISOString(),
    });
  });

  it('picking today after 09:00 defaults to the next quarter hour with no past-time error', () => {
    vi.setSystemTime(new Date(2026, 10, 25, 10, 7, 30));
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /November 25, 2026/ }));

    expect((screen.getByLabelText('calendar.time') as HTMLInputElement).value).toBe('10:15');
    expect(screen.queryByText('reminders.pastTime')).toBeNull();
    const set = screen.getByRole('button', { name: 'reminders.setCustom' }) as HTMLButtonElement;
    expect(set.disabled).toBe(false);
    fireEvent.click(set);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({
      remindAt: new Date(2026, 10, 25, 10, 15).toISOString(),
    });
  });

  it('a future day still defaults to 09:00', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /November 26, 2026/ }));
    expect((screen.getByLabelText('calendar.time') as HTMLInputElement).value).toBe('09:00');
  });

  it('rejects the last allowed day with a late time as tooFar', () => {
    render(<IssueReminderPanel issueId="i1" onClose={vi.fn()} />);
    // Horizon is now + 365 days = 2027-11-25 10:00; the calendar still allows that whole day.
    fireEvent.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    for (let i = 0; i < 11; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    }
    fireEvent.click(screen.getByRole('button', { name: /November 25, 2027/ }));
    fireEvent.change(screen.getByLabelText('calendar.time'), { target: { value: '23:59' } });

    expect(screen.getByText('reminders.tooFar')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'reminders.setCustom' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    // Boundary: the same day at 09:00 is within the horizon.
    fireEvent.change(screen.getByLabelText('calendar.time'), { target: { value: '09:00' } });
    expect(screen.queryByText('reminders.tooFar')).toBeNull();
  });
});
