import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueMock = vi.fn();

vi.mock('@/lib/transaction-queue', () => ({
  // A plain `function` (not an arrow function) so `new TransactionQueue()`
  // in the hook works — arrow functions aren't constructable, which
  // `vi.fn().mockImplementation(() => ...)` would otherwise wrap.
  TransactionQueue: vi.fn().mockImplementation(function TransactionQueueMock() {
    return { enqueue: enqueueMock };
  }),
}));

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

const toastErrorMock = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: { error: toastErrorMock },
}));

const findByIdMock = vi.fn();
const optimisticUpdateMock = vi.fn();
const applySyncActionMock = vi.fn();

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    issueStore: {
      applySyncAction: applySyncActionMock,
      findById: findByIdMock,
      optimisticUpdate: optimisticUpdateMock,
    },
  }),
}));

// Imported after the mocks above so the hook picks up the mocked modules.
const { useIssueUpdate } = await import('./use-issue-update');

/**
 * A full issue row as `ISSUE_UPDATE_MUTATION` returns it — every column in
 * `ISSUE_FIELDS`. The default reconcile validates this payload before handing it
 * to the store, because the store's apply is a whole-object replace: a partial
 * row would blank every column it omits, so a partial one is rejected rather
 * than applied. See `toIssueSyncRow` in `src/lib/issue-mappers.ts`.
 */
const SERVER_ISSUE = {
  archivedAt: null,
  assigneeId: 'usr_1',
  branchName: null,
  canceledAt: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  creatorId: 'usr_2',
  cycleId: null,
  description: null,
  dueDate: null,
  estimate: null,
  id: '1',
  identifier: 'ENG-1',
  labels: [{ color: 'red', id: 'lbl_1', name: 'bug' }],
  number: 1,
  organizationId: 'org_1',
  parentId: null,
  priority: 2,
  prioritySortOrder: 100,
  projectId: null,
  snoozedById: null,
  snoozedUntilAt: null,
  sortOrder: 50,
  startDate: null,
  startedAt: null,
  stateId: 'st_1',
  teamId: 'team_1',
  title: 'New (server)',
  trashed: false,
  triagedAt: null,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('useIssueUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('default (issueStore-backed) behavior', () => {
    it('snapshots via issueStore.findById and applies the patch via issueStore.optimisticUpdate', () => {
      findByIdMock.mockReturnValue({ id: '1', title: 'Old' });
      const { result } = renderHook(() => useIssueUpdate());

      act(() => {
        result.current('1', { title: 'New' });
      });

      expect(findByIdMock).toHaveBeenCalledWith('1');
      expect(optimisticUpdateMock).toHaveBeenCalledWith('1', { title: 'New' });
      expect(enqueueMock).toHaveBeenCalledTimes(1);
      const [, variables] = enqueueMock.mock.calls[0];
      expect(variables).toEqual({ id: '1', input: { title: 'New' } });
    });

    it('reconciles via issueStore.applySyncAction on mutation success', () => {
      findByIdMock.mockReturnValue({ id: '1', title: 'Old' });
      const { result } = renderHook(() => useIssueUpdate());

      act(() => {
        result.current('1', { title: 'New' });
      });

      const [, , callbacks] = enqueueMock.mock.calls[0];
      callbacks.onSuccess({ issueUpdate: { issue: SERVER_ISSUE } });

      expect(applySyncActionMock).toHaveBeenCalledWith('U', '1', {
        ...SERVER_ISSUE,
        // Labels are narrowed to ids on the way in — the store holds `labelIds`.
        labels: [{ id: 'lbl_1' }],
      });
    });

    it('does not reconcile a response that is not a whole issue row', () => {
      // The store's apply replaces the row outright, so forwarding a partial
      // payload would blank every column it omits.
      findByIdMock.mockReturnValue({ id: '1', title: 'Old' });
      const { result } = renderHook(() => useIssueUpdate());

      act(() => {
        result.current('1', { title: 'New' });
      });

      const [, , callbacks] = enqueueMock.mock.calls[0];
      callbacks.onSuccess({ issueUpdate: { issue: { id: '1', title: 'New (server)' } } });

      expect(applySyncActionMock).not.toHaveBeenCalled();
    });

    it('toasts and rolls back via issueStore.optimisticUpdate on mutation failure', () => {
      findByIdMock.mockReturnValue({ id: '1', title: 'Old' });
      const { result } = renderHook(() => useIssueUpdate());

      act(() => {
        result.current('1', { title: 'New' });
      });

      const [, , callbacks] = enqueueMock.mock.calls[0];
      callbacks.onError(new Error('boom'));

      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      // Called once for the optimistic apply, once more for the rollback.
      expect(optimisticUpdateMock).toHaveBeenCalledTimes(2);
      expect(optimisticUpdateMock).toHaveBeenNthCalledWith(2, '1', { id: '1', title: 'Old' });
    });

    it('skips rollback when there was no pre-update snapshot', () => {
      findByIdMock.mockReturnValue(null);
      const { result } = renderHook(() => useIssueUpdate());

      act(() => {
        result.current('1', { title: 'New' });
      });

      const [, , callbacks] = enqueueMock.mock.calls[0];
      callbacks.onError(new Error('boom'));

      expect(optimisticUpdateMock).toHaveBeenCalledTimes(1); // only the initial apply
    });
  });

  describe('injected overrides', () => {
    it('routes snapshot/apply/reconcile through the overrides instead of issueStore', () => {
      const snapshot = vi.fn().mockReturnValue({ id: '1', title: 'Old (local)' });
      const apply = vi.fn();
      const reconcile = vi.fn();

      const { result } = renderHook(() => useIssueUpdate({ apply, reconcile, snapshot }));

      act(() => {
        result.current('1', { title: 'New (local)' });
      });

      expect(snapshot).toHaveBeenCalledWith('1');
      expect(apply).toHaveBeenCalledWith('1', { title: 'New (local)' });
      expect(findByIdMock).not.toHaveBeenCalled();
      expect(optimisticUpdateMock).not.toHaveBeenCalled();

      const [, , callbacks] = enqueueMock.mock.calls[0];

      callbacks.onSuccess({ issueUpdate: { issue: { id: '1', title: 'New (server)' } } });
      expect(reconcile).toHaveBeenCalledWith('1', { id: '1', title: 'New (server)' });
      expect(applySyncActionMock).not.toHaveBeenCalled();

      callbacks.onError(new Error('boom'));
      expect(apply).toHaveBeenLastCalledWith('1', { id: '1', title: 'Old (local)' });
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(optimisticUpdateMock).not.toHaveBeenCalled();
    });

    it('falls back to the default for any override left unspecified (partial override)', () => {
      const apply = vi.fn();
      findByIdMock.mockReturnValue({ id: '1', title: 'Old' });

      const { result } = renderHook(() => useIssueUpdate({ apply }));

      act(() => {
        result.current('1', { title: 'New' });
      });

      // apply came from the override...
      expect(apply).toHaveBeenCalledWith('1', { title: 'New' });
      // ...but snapshot still fell back to the default issueStore-backed one.
      expect(findByIdMock).toHaveBeenCalledWith('1');
      expect(optimisticUpdateMock).not.toHaveBeenCalled();
    });
  });
});
