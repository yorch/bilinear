import { fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBCycle, DBProject, DBTeam } from '@/lib/db';
import { RootStore } from '@/stores/root-store';
import { BulkActionBar } from './bulk-action-bar';

const { storeHolder } = vi.hoisted(() => ({ storeHolder: {} as { current: RootStore } }));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));
vi.mock('next/navigation', () => ({ useParams: () => ({ key: 'ENG' }) }));

// jsdom does not implement <dialog>'s showModal/close; ConfirmDialog needs them.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

beforeEach(() => {
  storeHolder.current = new RootStore();
});

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ intlLocale: 'en-US' }),
}));

const base = {
  count: 2,
  labels: [],
  onClear: vi.fn(),
  onUpdate: vi.fn(),
  states: [],
  users: [],
};

describe('BulkActionBar', () => {
  it('reports the checked count and offers Archive only when the page can archive', () => {
    const onArchive = vi.fn();
    const { rerender } = render(<BulkActionBar {...base} onArchive={onArchive} />);
    expect(screen.getByText('issues.selectedCount:{"count":2}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'issues.archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);

    // A page that cannot archive (no handler) must not render a dead button.
    rerender(<BulkActionBar {...base} />);
    expect(screen.queryByRole('button', { name: 'issues.archive' })).toBeNull();
  });

  it('clears the selection through the dedicated control', () => {
    const onClear = vi.fn();
    render(<BulkActionBar {...base} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'issues.clearSelection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('offers Project, Cycle, Due date and Move to team, each writing the bulk patch', () => {
    const { teamStore, projectStore, cycleStore } = storeHolder.current;
    runInAction(() => {
      teamStore.applySyncAction('I', 't-eng', {
        createdAt: '1',
        id: 't-eng',
        key: 'ENG',
        name: 'Eng',
      } as DBTeam);
      teamStore.applySyncAction('I', 't-ops', {
        createdAt: '2',
        id: 't-ops',
        key: 'OPS',
        name: 'Ops',
      } as DBTeam);
      projectStore.applySyncAction('I', 'p1', { id: 'p1', name: 'Apollo' } as DBProject);
      cycleStore.applySyncAction('I', 'c1', {
        id: 'c1',
        name: 'Sprint 7',
        number: 7,
        teamId: 't-eng',
      } as DBCycle);
    });
    const onUpdate = vi.fn();
    render(<BulkActionBar {...base} onUpdate={onUpdate} />);

    const openMore = (entry: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'issues.bulkMore' }));
      fireEvent.click(screen.getByRole('button', { name: entry }));
    };
    openMore('issues.project');
    fireEvent.click(screen.getByRole('button', { name: 'Apollo' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ projectId: 'p1', projectMilestoneId: null });

    openMore('issues.cycle');
    fireEvent.click(screen.getByRole('button', { name: /Sprint 7/ }));
    expect(onUpdate).toHaveBeenLastCalledWith({ cycleId: 'c1' });

    // Desktop primary trigger (the More copy is the phone-only twin).
    fireEvent.click(screen.getAllByRole('button', { name: 'issues.dueDate' })[0]);
    // The themed calendar replaces the native date input: picking a day writes `YYYY-MM-DD`.
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    fireEvent.click(document.querySelector(`[data-date="${key}"]`) as HTMLElement);
    expect(onUpdate).toHaveBeenLastCalledWith({ dueDate: key });

    fireEvent.click(screen.getAllByRole('button', { name: 'issues.dueDate' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'properties.dueDate.clearDate' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ dueDate: null });

    openMore('issues.moveToTeam');
    fireEvent.click(screen.getByRole('button', { name: /OPS/ }));
    expect(onUpdate).toHaveBeenLastCalledWith({ teamId: 't-ops' });
  });

  it('on a multi-team selection shows Cycle disabled with an explanation instead of a team-less list', () => {
    const { cycleStore } = storeHolder.current;
    runInAction(() => {
      cycleStore.applySyncAction('I', 'c1', { id: 'c1', number: 1, teamId: 't-eng' } as DBCycle);
    });
    const { rerender } = render(<BulkActionBar {...base} mixedTeams />);
    fireEvent.click(screen.getByRole('button', { name: 'issues.bulkMore' }));
    const cycle = screen.getByRole('button', { name: 'issues.cycle' }) as HTMLButtonElement;
    expect(cycle.disabled).toBe(true);
    expect(cycle.title).toBe('issues.bulkCycleNeedsSameTeam');

    rerender(<BulkActionBar {...base} mixedTeams={false} teamId="t-eng" />);
    // The panel stays open across the rerender; the entry is now enabled.
    expect(
      (screen.getByRole('button', { name: 'issues.cycle' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('asks for confirmation before deleting', () => {
    const onDelete = vi.fn();
    render(<BulkActionBar {...base} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' }).at(-1) as HTMLElement);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('is a full-width wrapping bar on phones so Delete is never scrolled out of sight', () => {
    render(<BulkActionBar {...base} />);
    const bar = screen.getByTestId('bulk-action-bar');
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('flex-wrap');
    // md+ is held to one row (a bare `flex-nowrap` would also stop phones wrapping).
    expect(bar.className.split(' ')).not.toContain('flex-nowrap');
    expect(bar.className).toContain('md:flex-nowrap');
    expect(bar.className).not.toContain('overflow-x-auto');
  });

  it('keeps Archive and Delete together in one group, after the rest of the actions', () => {
    render(<BulkActionBar {...base} onArchive={vi.fn()} onDelete={vi.fn()} />);
    const archive = screen.getByRole('button', { name: 'issues.archive' });
    const del = screen.getByRole('button', { name: 'common.delete' });
    expect(archive.parentElement).toBe(del.parentElement);
    const more = screen.getByRole('button', { name: 'issues.bulkMore' });
    expect(more.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
