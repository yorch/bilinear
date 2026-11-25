import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueue = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
const translate = vi.fn((key: string, _params?: unknown) => key);
const optimisticUpdate = vi.fn();
const applySyncAction = vi.fn();

vi.mock('@/lib/toast', () => ({ toast: { error: toastError, info: toastInfo } }));
vi.mock('@/lib/transaction-queue', () => ({
  TransactionQueue: class {
    enqueue = enqueue;
  },
}));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => translate }));

const rows: Record<string, Record<string, unknown>> = {
  a: { cycleId: 'old-cycle', id: 'a', stateId: 'eng-done', teamId: 'eng' },
  b: { cycleId: null, id: 'b', stateId: 'eng-todo', teamId: 'eng' },
};
vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    issueStore: { applySyncAction, findById: (id: string) => rows[id], optimisticUpdate },
    teamStore: { findById: () => ({ defaultIssueStateId: 'ops-default' }) },
    workflowStateStore: {
      findById: (id: string) =>
        ({
          'eng-done': { id: 'eng-done', name: 'Done', type: 'completed' },
          'eng-todo': { id: 'eng-todo', name: 'Todo', type: 'unstarted' },
        })[id],
      findByTeamId: () => [
        { id: 'ops-backlog', name: 'Backlog', type: 'backlog' },
        { id: 'ops-done', name: 'Finished', type: 'completed' },
      ],
    },
  }),
}));

const { useIssuesBulkUpdate } = await import('./use-issues-bulk-update');

describe('useIssuesBulkUpdate team move', () => {
  beforeEach(() => {
    enqueue.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    optimisticUpdate.mockReset();
  });

  it('optimistically remaps the state and clears the cycle, not just the team', () => {
    const { result } = renderHook(() => useIssuesBulkUpdate());
    result.current(['a', 'b'], { teamId: 'ops' });
    // a: same type (completed) -> ops-done; b: no match -> team default.
    expect(optimisticUpdate).toHaveBeenCalledWith('a', {
      cycleId: null,
      stateId: 'ops-done',
      teamId: 'ops',
    });
    expect(optimisticUpdate).toHaveBeenCalledWith('b', {
      cycleId: null,
      stateId: 'ops-default',
      teamId: 'ops',
    });
  });

  it('shows ONE toast for a batch where several rows fail, after all settled', () => {
    const { result } = renderHook(() => useIssuesBulkUpdate());
    result.current(['a', 'b'], { teamId: 'ops' });
    const [first, second] = enqueue.mock.calls.map(c => c[2] as { onError: () => void });
    first.onError();
    expect(toastError).not.toHaveBeenCalled();
    second.onError();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('rolls a failed row back to its snapshot and stays silent when all succeed', () => {
    const { result } = renderHook(() => useIssuesBulkUpdate());
    result.current(['a', 'b'], { teamId: 'ops' });
    const [first, second] = enqueue.mock.calls.map(
      c => c[2] as { onError: () => void; onSuccess: (d: unknown) => void },
    );
    first.onError();
    expect(optimisticUpdate).toHaveBeenLastCalledWith('a', rows.a);
    second.onSuccess({});
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('shows ONE de-duplicated labels-dropped toast for the batch, after the last row settles', () => {
    const { result } = renderHook(() => useIssuesBulkUpdate());
    result.current(['a', 'b'], { teamId: 'ops' });
    const [first, second] = enqueue.mock.calls.map(
      c => c[2] as { onSuccess: (d: unknown) => void },
    );
    first.onSuccess({ issueUpdate: { droppedLabelNames: ['eng-only', 'infra'] } });
    expect(toastInfo).not.toHaveBeenCalled();
    second.onSuccess({ issueUpdate: { droppedLabelNames: ['eng-only'] } });
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith('issues.labelsDroppedOnBulkMove');
    expect(translate).toHaveBeenCalledWith('issues.labelsDroppedOnBulkMove', {
      count: 2,
      issues: 2,
      labels: 'eng-only, infra',
    });
  });

  it('stays silent about labels when none were dropped', () => {
    const { result } = renderHook(() => useIssuesBulkUpdate());
    result.current(['a', 'b'], { teamId: 'ops' });
    for (const c of enqueue.mock.calls) {
      (c[2] as { onSuccess: (d: unknown) => void }).onSuccess({
        issueUpdate: { droppedLabelNames: [] },
      });
    }
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
