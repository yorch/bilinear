import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRecentItems } from './use-recent-items';

function makeItem(
  id: string,
  overrides: Partial<{ identifier: string; teamKey: string; title: string }> = {},
) {
  return {
    id,
    identifier: overrides.identifier ?? `ENG-${id}`,
    teamKey: overrides.teamKey ?? 'ENG',
    title: overrides.title ?? `Issue ${id}`,
  };
}

describe('useRecentItems', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when nothing is in storage', () => {
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.items).toEqual([]);
  });

  it('adds an item and persists it to localStorage', () => {
    const { result } = renderHook(() => useRecentItems('acme'));

    act(() => {
      result.current.addRecent(makeItem('1'));
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.id).toBe('1');

    const raw = localStorage.getItem('bilinear:acme:recent-issues');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '[]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('1');
  });

  it('prepends new items, most recent first', () => {
    const { result } = renderHook(() => useRecentItems('acme'));

    act(() => {
      result.current.addRecent(makeItem('1'));
    });
    act(() => {
      result.current.addRecent(makeItem('2'));
    });

    expect(result.current.items.map(i => i.id)).toEqual(['2', '1']);
  });

  it('dedups: re-adding an existing id moves it to the front instead of duplicating', () => {
    const { result } = renderHook(() => useRecentItems('acme'));

    act(() => {
      result.current.addRecent(makeItem('1'));
      result.current.addRecent(makeItem('2'));
      result.current.addRecent(makeItem('3'));
    });
    act(() => {
      result.current.addRecent(makeItem('1', { title: 'Updated title' }));
    });

    expect(result.current.items.map(i => i.id)).toEqual(['1', '3', '2']);
    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[0]?.title).toBe('Updated title');
  });

  it('caps the list at the 5 most recent items', () => {
    const { result } = renderHook(() => useRecentItems('acme'));

    act(() => {
      for (const id of ['1', '2', '3', '4', '5', '6']) {
        result.current.addRecent(makeItem(id));
      }
    });

    expect(result.current.items).toHaveLength(5);
    // The oldest ('1') should have been dropped, most recent ('6') kept first.
    expect(result.current.items.map(i => i.id)).toEqual(['6', '5', '4', '3', '2']);
  });

  it('loads existing items from localStorage on mount', () => {
    const existing = [makeItem('1'), makeItem('2')].map(i => ({ ...i, visitedAt: Date.now() }));
    localStorage.setItem('bilinear:acme:recent-issues', JSON.stringify(existing));

    const { result } = renderHook(() => useRecentItems('acme'));

    expect(result.current.items.map(i => i.id)).toEqual(['1', '2']);
  });

  it('scopes storage independently per workspaceKey', () => {
    const acme = renderHook(() => useRecentItems('acme'));
    const beta = renderHook(() => useRecentItems('beta'));

    act(() => {
      acme.result.current.addRecent(makeItem('acme-1'));
    });
    act(() => {
      beta.result.current.addRecent(makeItem('beta-1'));
    });

    expect(localStorage.getItem('bilinear:acme:recent-issues')).toContain('acme-1');
    expect(localStorage.getItem('bilinear:beta:recent-issues')).toContain('beta-1');
    expect(localStorage.getItem('bilinear:acme:recent-issues')).not.toContain('beta-1');
  });

  it('reloads the list when workspaceKey changes on an existing hook instance', () => {
    localStorage.setItem(
      'bilinear:beta:recent-issues',
      JSON.stringify([{ ...makeItem('beta-item'), visitedAt: Date.now() }]),
    );

    const { result, rerender } = renderHook(({ key }) => useRecentItems(key), {
      initialProps: { key: 'acme' as string | undefined },
    });

    act(() => {
      result.current.addRecent(makeItem('acme-item'));
    });
    expect(result.current.items.map(i => i.id)).toEqual(['acme-item']);

    rerender({ key: 'beta' });

    expect(result.current.items.map(i => i.id)).toEqual(['beta-item']);
    // Switching workspaces must not have clobbered acme's storage.
    const acmeRaw = localStorage.getItem('bilinear:acme:recent-issues');
    expect(acmeRaw).toContain('acme-item');
  });

  it('falls back to the unscoped key when no workspaceKey is given', () => {
    const { result } = renderHook(() => useRecentItems());

    act(() => {
      result.current.addRecent(makeItem('1'));
    });

    const raw = localStorage.getItem('bilinear:recent-issues');
    expect(raw).toContain('"id":"1"');
  });
});
