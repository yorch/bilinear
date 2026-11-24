import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootStore } from '@/stores/root-store';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
const { storeHolder, gqlQuery, gqlMutate, toast } = vi.hoisted(() => ({
  gqlMutate: vi.fn(),
  gqlQuery: vi.fn(),
  storeHolder: {} as { current: unknown },
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));
vi.mock('@/lib/graphql', () => ({ gqlMutate, gqlQuery }));
vi.mock('@/lib/toast', () => ({ toast }));

const { ProjectArchivedView } = await import('./project-archived-view');

const row = (id: string) => ({
  archivedAt: `2026-05-${id.padStart(2, '0')}T00:00:00Z`,
  color: '#fff',
  icon: null,
  id,
  name: `Project ${id}`,
});
const page = (ids: string[], next: string | null) => ({
  nodes: ids.map(row),
  pageInfo: { endCursor: next, hasNextPage: next !== null },
});

describe('ProjectArchivedView', () => {
  beforeEach(() => {
    storeHolder.current = new RootStore();
    gqlQuery.mockReset();
    gqlMutate.mockReset();
    toast.error.mockReset();
  });
  afterEach(cleanup);

  it('asks the server for archived rows only, so live rows never use up a page slot', async () => {
    gqlQuery.mockResolvedValue(page(['1'], null));
    render(<ProjectArchivedView />);
    await screen.findByText('Project 1');
    const [query, vars] = gqlQuery.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain('archivedOnly: true');
    expect(query).not.toContain('includeArchived');
    expect(vars.first).toBe(50);
  });

  it('pages: shows Load more while the server has another page and appends it', async () => {
    gqlQuery.mockResolvedValueOnce(page(['1', '2'], 'c2'));
    render(<ProjectArchivedView />);
    await screen.findByText('Project 2');
    gqlQuery.mockResolvedValueOnce(page(['3'], null));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'projects.loadMoreArchived' }));
    });

    await screen.findByText('Project 3');
    expect((gqlQuery.mock.calls[1] as [string, { after: string }])[1].after).toBe('c2');
    expect(screen.getByText('Project 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'projects.loadMoreArchived' })).toBeNull();
  });

  it('shows the localized fallback, never the server text, when a restore fails', async () => {
    gqlQuery.mockResolvedValue(page(['1'], null));
    gqlMutate.mockRejectedValue(new Error('Project not found in organization abc'));
    render(<ProjectArchivedView />);
    await screen.findByText('Project 1');
    fireEvent.click(screen.getByRole('button', { name: /common.restore/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('projects.failedToUnarchive'));
  });
});
