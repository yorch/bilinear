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

const { storeHolder, snoozeSpy, unsnoozeSpy, favoriteSpy, enqueueSpy, toastSuccess, toastError } =
  vi.hoisted(() => ({
    enqueueSpy: vi.fn(),
    favoriteSpy: vi.fn(),
    snoozeSpy: vi.fn(),
    storeHolder: {} as { current: RootStore },
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    unsnoozeSpy: vi.fn(),
  }));
vi.mock('@/lib/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('@/lib/transaction-queue', () => ({
  TransactionQueue: class {
    enqueue = enqueueSpy;
  },
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
  enqueueSpy.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
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

  describe('Mark as duplicate', () => {
    function openDuplicatePicker() {
      seedIssue();
      runInAction(() => {
        storeHolder.current.issueStore.applySyncAction('I', 'orig', {
          ...storeHolder.current.issueStore.findById('issue-1'),
          id: 'orig',
          identifier: 'ENG-9',
          title: 'Original thing',
        } as DBIssue);
      });
      render(<IssueContextMenu {...baseProps} onUpdate={vi.fn()} />);
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'commandPalette.submenu.markDuplicate' }),
      );
      fireEvent.change(screen.getByLabelText('issues.pickerSearchPlaceholder'), {
        target: { value: 'Original' },
      });
      fireEvent.click(screen.getByText('Original thing'));
    }

    it('sends only the relation mutation: no client-side state write, no early toast', () => {
      const onUpdate = vi.fn();
      seedIssue();
      runInAction(() => {
        storeHolder.current.workflowStateStore.applySyncAction('I', 'canceled-1', {
          id: 'canceled-1',
          name: 'Canceled',
          teamId: 't1',
          type: 'canceled',
        } as never);
        storeHolder.current.issueStore.applySyncAction('I', 'orig', {
          ...storeHolder.current.issueStore.findById('issue-1'),
          id: 'orig',
          identifier: 'ENG-9',
          title: 'Original thing',
        } as DBIssue);
      });
      render(<IssueContextMenu {...baseProps} onUpdate={onUpdate} />);
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'commandPalette.submenu.markDuplicate' }),
      );
      fireEvent.change(screen.getByLabelText('issues.pickerSearchPlaceholder'), {
        target: { value: 'Original' },
      });
      fireEvent.click(screen.getByText('Original thing'));

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(enqueueSpy.mock.calls[0][1]).toEqual({
        input: { issueId: 'issue-1', relatedIssueId: 'orig', type: 'duplicate' },
      });
      expect(onUpdate).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('toasts only once the server accepted the relation', () => {
      openDuplicatePicker();
      const callbacks = enqueueSpy.mock.calls[0][2] as { onSuccess: () => void };
      callbacks.onSuccess();
      expect(toastSuccess).toHaveBeenCalledWith('issues.markedDuplicateToast');
    });

    it('reports a failed relation as an error and never as success', () => {
      openDuplicatePicker();
      const callbacks = enqueueSpy.mock.calls[0][2] as { onError: () => void };
      callbacks.onError();
      expect(toastError).toHaveBeenCalledWith('issueDetail.relations.failedToCreate');
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Copy as Markdown', () => {
    it('escapes brackets in the title and confirms with a toast', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      seedIssue();
      render(<IssueContextMenu {...baseProps} title="Fix [WIP] parser" />);
      fireEvent.click(screen.getByRole('menuitem', { name: 'issues.copyAsMarkdown' }));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0][0]).toContain('[ENG-1 Fix \\[WIP\\] parser](');
      await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('issues.markdownCopied'));
    });

    it('shows an error toast when the clipboard write is refused', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
      });
      seedIssue();
      render(<IssueContextMenu {...baseProps} />);
      fireEvent.click(screen.getByRole('menuitem', { name: 'issues.copyAsMarkdown' }));
      await vi.waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('issueDetail.properties.copyFailed'),
      );
    });
  });

  describe('property sub-menus are scoped to the issue team', () => {
    it('Set cycle lists only the issue team cycles', () => {
      seedIssue();
      runInAction(() => {
        const base = {
          createdAt: 'x',
          endsAt: '2026-12-01',
          organizationId: 'org',
          startsAt: '2026-11-01',
          updatedAt: 'x',
        };
        storeHolder.current.cycleStore.applySyncAction('I', 'c-eng', {
          ...base,
          id: 'c-eng',
          name: 'ENG sprint',
          number: 1,
          teamId: 't1',
        } as never);
        storeHolder.current.cycleStore.applySyncAction('I', 'c-ops', {
          ...base,
          id: 'c-ops',
          name: 'OPS sprint',
          number: 1,
          teamId: 't2',
        } as never);
        storeHolder.current.teamStore.upsertMany([
          {
            createdAt: 'a',
            cyclesEnabled: true,
            id: 't1',
            issueEstimationType: 'notUsed',
            key: 'ENG',
            name: 'Engineering',
          } as never,
        ]);
      });
      render(<IssueContextMenu {...baseProps} onUpdate={vi.fn()} />);
      fireEvent.click(screen.getByRole('menuitem', { name: 'commandPalette.submenu.setCycle' }));
      expect(screen.getByText('ENG sprint')).toBeTruthy();
      expect(screen.queryByText('OPS sprint')).toBeNull();
    });

    it('Move to team never offers the issue current team', () => {
      seedIssue();
      runInAction(() => {
        storeHolder.current.teamStore.upsertMany([
          { createdAt: 'a', id: 't1', key: 'ENG', name: 'Engineering' } as never,
          { createdAt: 'b', id: 't2', key: 'OPS', name: 'Operations' } as never,
        ]);
      });
      const onUpdate = vi.fn();
      render(<IssueContextMenu {...baseProps} onUpdate={onUpdate} />);
      fireEvent.click(screen.getByRole('menuitem', { name: 'commandPalette.submenu.moveToTeam' }));
      expect(screen.queryByText('Engineering')).toBeNull();
      fireEvent.click(screen.getByText('Operations'));
      expect(onUpdate).toHaveBeenCalledWith({ teamId: 't2' });
    });
  });
});
