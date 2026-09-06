import { fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBIssue } from '@/lib/db';
import { RootStore } from '@/stores/root-store';
import { IssueContextMenu } from './issue-context-menu';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatDate: (v: Date | string) => String(v) }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspace: 'acme' }),
}));

const { storeHolder, snoozeSpy, unsnoozeSpy, favoriteSpy } = vi.hoisted(() => ({
  favoriteSpy: vi.fn(),
  snoozeSpy: vi.fn(),
  storeHolder: {} as { current: RootStore },
  unsnoozeSpy: vi.fn(),
}));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => storeHolder.current,
}));
vi.mock('@/hooks/use-issue-snooze', () => ({
  useIssueSnooze: () => ({ snooze: snoozeSpy, unsnooze: unsnoozeSpy }),
}));
vi.mock('@/hooks/use-favorite-toggle', () => ({
  useFavoriteToggle: (_type: string, id: string) => ({
    isFavorite: storeHolder.current.favoriteStore.getByEntityId(id) !== null,
    pending: false,
    toggle: favoriteSpy,
  }),
}));

function seedIssue(patch: Partial<DBIssue> = {}) {
  runInAction(() => {
    storeHolder.current.issueStore.applySyncAction('I', 'issue-1', {
      createdAt: '2026-09-01T00:00:00Z',
      id: 'issue-1',
      identifier: 'ENG-1',
      labelIds: [],
      number: 1,
      organizationId: 'org',
      priority: 0,
      prioritySortOrder: 0,
      sortOrder: 0,
      stateId: 's1',
      teamId: 't1',
      title: 'Fix it',
      trashed: false,
      updatedAt: '2026-09-01T00:00:00Z',
      ...patch,
    } as DBIssue);
  });
}

const baseProps = {
  identifier: 'ENG-1',
  issueId: 'issue-1',
  onClose: vi.fn(),
  onOpen: vi.fn(),
  title: 'Fix it',
  x: 0,
  y: 0,
};

beforeEach(() => {
  storeHolder.current = new RootStore();
  snoozeSpy.mockReset();
  unsnoozeSpy.mockReset();
  favoriteSpy.mockReset();
});

describe('IssueContextMenu', () => {
  it('hides Archive and Delete when the surface provides no handler', () => {
    seedIssue();
    render(<IssueContextMenu {...baseProps} />);
    expect(screen.queryByRole('menuitem', { name: 'issues.archive' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'common.delete' })).toBeNull();
  });

  it('shows Archive and Delete and routes them to the handlers when provided', () => {
    seedIssue();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(<IssueContextMenu {...baseProps} onArchive={onArchive} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'issues.archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('offers Snooze with presets when the issue is awake', () => {
    seedIssue();
    render(<IssueContextMenu {...baseProps} />);
    expect(screen.queryByRole('menuitem', { name: 'issues.snooze.unsnooze' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'issues.snooze.snooze' }));
    fireEvent.click(screen.getByText('issues.snooze.tomorrow'));
    expect(snoozeSpy).toHaveBeenCalledTimes(1);
    const [id, until] = snoozeSpy.mock.calls[0] as [string, Date];
    expect(id).toBe('issue-1');
    expect(until.getTime()).toBeGreaterThan(Date.now());
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('offers Unsnooze instead while the issue is snoozed', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    seedIssue({ snoozedUntilAt: future });
    render(<IssueContextMenu {...baseProps} />);
    expect(screen.queryByRole('menuitem', { name: 'issues.snooze.snooze' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'issues.snooze.unsnooze' }));
    expect(unsnoozeSpy).toHaveBeenCalledWith('issue-1');
  });

  it('labels the favorites item from the store state and toggles it', () => {
    seedIssue();
    const { unmount } = render(<IssueContextMenu {...baseProps} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'favorites.addToFavorites' }));
    expect(favoriteSpy).toHaveBeenCalledTimes(1);
    unmount();

    runInAction(() => {
      storeHolder.current.favoriteStore.applySyncAction('I', 'fav-1', {
        createdAt: '2026-09-01T00:00:00Z',
        entityId: 'issue-1',
        entityType: 'Issue',
        id: 'fav-1',
        organizationId: 'org',
        sortOrder: 0,
        userId: 'u1',
      });
    });
    render(<IssueContextMenu {...baseProps} />);
    expect(screen.getByRole('menuitem', { name: 'nav.removeFromFavorites' })).toBeTruthy();
  });
});
