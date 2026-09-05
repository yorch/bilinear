import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBWorkflowState } from '@/lib/db';
import { RootStore } from '@/stores/root-store';
import { TeamWorkflowSection } from './team-workflow-section';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params?.name ? `${key}:${params.name}` : key,
}));

const { storeHolder, gqlMutate, toast } = vi.hoisted(() => ({
  gqlMutate: vi.fn(),
  storeHolder: {} as { current: RootStore },
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));
vi.mock('@/lib/graphql', () => ({ gqlMutate }));
vi.mock('@/lib/toast', () => ({ toast }));

function state(overrides: Partial<DBWorkflowState>): DBWorkflowState {
  return {
    color: 'var(--info)',
    createdAt: '2026-01-01T00:00:00Z',
    id: 's',
    name: 'State',
    position: 0,
    teamId: 'team-1',
    type: 'unstarted',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const BACKLOG = state({ id: 'backlog', name: 'Backlog', position: 1, type: 'backlog' });
const TODO = state({ id: 'todo', name: 'Todo', position: 2 });
const DONE = state({ id: 'done', name: 'Done', position: 3, type: 'completed' });

beforeEach(() => {
  gqlMutate.mockReset();
  storeHolder.current = new RootStore();
  runInAction(() => {
    storeHolder.current.workflowStateStore.upsertMany([DONE, TODO, BACKLOG]);
  });
});

describe('TeamWorkflowSection', () => {
  it('renders states in position order with the default badge', () => {
    render(<TeamWorkflowSection defaultStateId="backlog" teamId="team-1" />);
    const items = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
    expect(items[0]).toContain('Backlog');
    expect(items[1]).toContain('Todo');
    expect(items[2]).toContain('Done');
    expect(items[0]).toContain('settings.team.workflowStates.default');
    expect(items[1]).not.toContain('settings.team.workflowStates.default');
  });

  it('refuses to archive the default state but allows others', () => {
    render(<TeamWorkflowSection defaultStateId="backlog" teamId="team-1" />);
    expect(
      screen.getByRole('button', { name: 'settings.team.workflowStates.archiveAria:Backlog' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'settings.team.workflowStates.archiveAria:Todo' }),
    ).toBeEnabled();
  });

  it('moving a state down swaps positions with its neighbour', async () => {
    gqlMutate.mockImplementation(
      async (_q: string, vars: { id: string; input: { position: number } }) => ({
        workflowStateUpdate: {
          workflowState: {
            ...storeHolder.current.workflowStateStore.findById(vars.id),
            position: vars.input.position,
          },
        },
      }),
    );
    render(<TeamWorkflowSection defaultStateId={null} teamId="team-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.team.workflowStates.moveDown:Todo' }),
    );

    await waitFor(() => expect(gqlMutate).toHaveBeenCalledTimes(2));
    expect(gqlMutate.mock.calls[0][1]).toEqual({ id: 'todo', input: { position: 3 } });
    expect(gqlMutate.mock.calls[1][1]).toEqual({ id: 'done', input: { position: 2 } });
    await waitFor(() => {
      const items = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
      expect(items[1]).toContain('Done');
      expect(items[2]).toContain('Todo');
    });
  });

  it('the first row cannot move up and the last cannot move down', () => {
    render(<TeamWorkflowSection defaultStateId={null} teamId="team-1" />);
    expect(
      screen.getByRole('button', { name: 'settings.team.workflowStates.moveUp:Backlog' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'settings.team.workflowStates.moveDown:Done' }),
    ).toBeDisabled();
  });

  it('creates a state at the next position', async () => {
    gqlMutate.mockResolvedValueOnce({
      workflowStateCreate: {
        workflowState: state({ id: 'review', name: 'Review', position: 4 }),
      },
    });
    render(<TeamWorkflowSection defaultStateId={null} teamId="team-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.team.workflowStates.add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'settings.team.workflowStates.name' }), {
      target: { value: 'Review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.team.workflowStates.add' }));

    await waitFor(() => expect(gqlMutate).toHaveBeenCalledTimes(1));
    expect(gqlMutate.mock.calls[0][1].input).toMatchObject({
      name: 'Review',
      position: 4,
      teamId: 'team-1',
      type: 'unstarted',
    });
    await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
  });
});
