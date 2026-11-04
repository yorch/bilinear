import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIssueListPage } from './use-issue-list-page';

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({ issueStore: { findById: () => null }, labelStore: {} }),
}));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/transaction-queue', () => ({ TransactionQueue: class {} }));

const issues = [{ id: 'a' }, { id: 'b' }] as never;

function setup() {
  return renderHook(() =>
    useIssueListPage({ basePath: '/x', buildHref: id => `/x/${id}`, issues }),
  );
}

function setLarge(large: boolean) {
  window.matchMedia = ((q: string) => ({
    addEventListener: () => {},
    matches: large && q.includes('1024'),
    removeEventListener: () => {},
  })) as never;
}

describe('useIssueListPage property hotkeys', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens the popover on a wide viewport', () => {
    setLarge(true);
    const { result } = setup();
    act(() => result.current.setSelectedId('a'));
    fireEvent.keyDown(window, { key: 'a' });
    expect(result.current.openProperty).toBe('assignee');
    expect(result.current.detailIssueId).toBeNull();
  });

  it('below lg, A opens the detail panel instead of a popover in a hidden cell', () => {
    setLarge(false);
    const { result } = setup();
    act(() => result.current.setSelectedId('a'));
    fireEvent.keyDown(window, { key: 'a' });
    expect(result.current.openProperty).toBeNull();
    expect(result.current.detailIssueId).toBe('a');
  });

  it('status and priority stay inline on narrow viewports (their cells are visible)', () => {
    setLarge(false);
    const { result } = setup();
    act(() => result.current.setSelectedId('a'));
    fireEvent.keyDown(window, { key: 's' });
    expect(result.current.openProperty).toBe('status');
  });
});
