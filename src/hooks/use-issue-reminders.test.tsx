import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootStore } from '@/stores/root-store';

const { enqueue, storeHolder, toastError, toastSuccess } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  storeHolder: {} as { current: RootStore },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/transaction-queue', () => ({
  TransactionQueue: vi.fn().mockImplementation(function TransactionQueueMock() {
    return { enqueue };
  }),
}));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));

const { useIssueReminders, ISSUE_REMINDER_SET_MUTATION, ISSUE_REMINDER_CLEAR_MUTATION } =
  await import('./use-issue-reminders');

const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000);
const confirmed = (over = {}) => ({
  createdAt: '2026-11-24T00:00:00Z',
  id: 'r1',
  issueId: 'i1',
  organizationId: 'org',
  remindAt: IN_AN_HOUR().toISOString(),
  updatedAt: '2026-11-24T00:00:00Z',
  userId: 'me',
  ...over,
});

/** Callbacks passed to the (single) enqueued transaction. */
function callbacks() {
  return enqueue.mock.calls[0][2] as {
    onError: (e: Error) => void;
    onSuccess: (d: unknown) => void;
  };
}

beforeEach(() => {
  storeHolder.current = new RootStore();
  storeHolder.current.userStore.currentUserId = 'me';
  enqueue.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('useIssueReminders', () => {
  it('shows the reminder immediately and queues the mutation (offline-capable path)', () => {
    const { result } = renderHook(() => useIssueReminders());
    const at = IN_AN_HOUR();

    act(() => result.current.setReminder('i1', at));

    // Chip data is there before any server round-trip.
    expect(result.current.reminderFor('i1')?.remindAt).toBe(at.toISOString());
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0]).toBe(ISSUE_REMINDER_SET_MUTATION);
    expect(enqueue.mock.calls[0]?.[1]).toEqual({ issueId: 'i1', remindAt: at.toISOString() });
  });

  it('swaps the optimistic row for the confirmed one on success', () => {
    const { result } = renderHook(() => useIssueReminders());
    act(() => result.current.setReminder('i1', IN_AN_HOUR()));
    const { onSuccess } = callbacks();

    act(() => onSuccess({ issueReminderSet: { reminder: confirmed() } }));

    expect(storeHolder.current.issueReminderStore.pool.size).toBe(1);
    expect(storeHolder.current.issueReminderStore.forIssue('i1')?.id).toBe('r1');
  });

  it('rolls a failed set back to nothing, with the localized toast (not the server text)', () => {
    const { result } = renderHook(() => useIssueReminders());
    act(() => result.current.setReminder('i1', IN_AN_HOUR()));
    const { onError } = callbacks();

    act(() => onError(new Error('Reminder time must be in the future')));

    expect(result.current.reminderFor('i1')).toBeNull();
    expect(toastError).toHaveBeenCalledWith('reminders.setFailed');
  });

  it('rolls a failed move back to the previous reminder', () => {
    storeHolder.current.issueReminderStore.upsertMany([
      confirmed({ remindAt: '2099-01-01T09:00:00Z' }),
    ]);
    const { result } = renderHook(() => useIssueReminders());
    act(() => result.current.setReminder('i1', IN_AN_HOUR()));
    const { onError } = callbacks();

    act(() => onError(new Error('x')));

    expect(result.current.reminderFor('i1')?.remindAt).toBe('2099-01-01T09:00:00Z');
  });

  it('clear hides the chip at once, queues the clear, and restores on failure', () => {
    storeHolder.current.issueReminderStore.upsertMany([
      confirmed({ remindAt: '2099-01-01T09:00:00Z' }),
    ]);
    const { result } = renderHook(() => useIssueReminders());

    act(() => result.current.clearReminder('i1'));

    expect(result.current.reminderFor('i1')).toBeNull();
    expect(enqueue.mock.calls[0]?.[0]).toBe(ISSUE_REMINDER_CLEAR_MUTATION);
    expect(enqueue.mock.calls[0]?.[1]).toEqual({ issueId: 'i1' });
    const { onError } = callbacks();
    act(() => onError(new Error('x')));
    expect(result.current.reminderFor('i1')?.id).toBe('r1');
    expect(toastError).toHaveBeenCalledWith('reminders.clearFailed');
  });

  it('reminderFor hides a reminder whose time has passed even if no delete has arrived', () => {
    storeHolder.current.issueReminderStore.upsertMany([
      confirmed({ remindAt: '2020-01-01T09:00:00Z' }),
    ]);
    const { result } = renderHook(() => useIssueReminders());
    expect(result.current.reminderFor('i1')).toBeNull();
  });
});
