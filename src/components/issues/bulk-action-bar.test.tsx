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

    fireEvent.click(screen.getByRole('button', { name: 'issues.project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apollo' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ projectId: 'p1', projectMilestoneId: null });

    fireEvent.click(screen.getByRole('button', { name: 'issues.cycle' }));
    fireEvent.click(screen.getByRole('button', { name: /Sprint 7/ }));
    expect(onUpdate).toHaveBeenLastCalledWith({ cycleId: 'c1' });

    fireEvent.click(screen.getByRole('button', { name: 'issues.dueDate' }));
    fireEvent.click(screen.getByRole('button', { name: 'properties.dueDate.clearDate' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ dueDate: null });

    fireEvent.click(screen.getByRole('button', { name: 'issues.moveToTeam' }));
    fireEvent.click(screen.getByRole('button', { name: /OPS/ }));
    expect(onUpdate).toHaveBeenLastCalledWith({ teamId: 't-ops' });
  });

  it('on a multi-team selection shows Cycle disabled with an explanation instead of a team-less list', () => {
    const { cycleStore } = storeHolder.current;
    runInAction(() => {
      cycleStore.applySyncAction('I', 'c1', { id: 'c1', number: 1, teamId: 't-eng' } as DBCycle);
    });
    const { rerender } = render(<BulkActionBar {...base} mixedTeams />);
    const cycle = screen.getByRole('button', { name: 'issues.cycle' }) as HTMLButtonElement;
    expect(cycle.disabled).toBe(true);
    expect(cycle.title).toBe('issues.bulkCycleNeedsSameTeam');

    rerender(<BulkActionBar {...base} mixedTeams={false} teamId="t-eng" />);
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

  it('is a full-width single-row scroller on phones', () => {
    render(<BulkActionBar {...base} />);
    const bar = screen.getByTestId('bulk-action-bar');
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('flex-nowrap');
    expect(bar.className).toContain('overflow-x-auto');
  });
});
