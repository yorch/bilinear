import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueMock = vi.fn();
const pushMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock('@/lib/transaction-queue', () => ({
  TransactionQueue: vi.fn().mockImplementation(function TransactionQueueMock() {
    return { enqueue: enqueueMock };
  }),
}));
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}:${params.identifier}` : key,
}));
vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: toastSuccessMock },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspace: 'demo' }),
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    issueStore: { applySyncAction: vi.fn(), pool: new Map() },
  }),
}));

const { useIssueCreate } = await import('./use-issue-create');

const TEAM = { id: 'team_1', key: 'ENG', organizationId: 'org_1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useIssueCreate', () => {
  it('toasts "<identifier> created" with an Open action once the server numbers the issue', async () => {
    const { result } = renderHook(() => useIssueCreate(TEAM, []));
    await act(async () => {
      await result.current({ labelIds: [], priority: 0, title: 'x' });
    });
    const callbacks = enqueueMock.mock.calls[0]?.[2];
    act(() => {
      callbacks.onSuccess({ issueCreate: { issue: { id: 'iss_9', identifier: 'ENG-12' } } });
    });
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [message, action] = toastSuccessMock.mock.calls[0] ?? [];
    expect(message).toContain('ENG-12');
    action.onClick();
    expect(pushMock).toHaveBeenCalledWith('/demo/issue/iss_9');
  });

  it('stamps each create with its own client id so a replayed send is idempotent server-side', async () => {
    const { result } = renderHook(() => useIssueCreate(TEAM, []));
    await act(async () => {
      await result.current({ labelIds: [], priority: 0, title: 'a' });
      await result.current({ labelIds: [], priority: 0, title: 'b' });
    });
    const ids = enqueueMock.mock.calls.map(c => c[1].input.id);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[0]).not.toMatch(/^temp-/);
    expect(ids[1]).toEqual(expect.any(String));
    expect(ids[1]).not.toBe(ids[0]);
  });
});
