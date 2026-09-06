import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBIssueLabel } from '@/lib/db';
import { RootStore } from '@/stores/root-store';
import { labelsForTeam, TeamLabelsSection } from './team-labels-section';

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

// jsdom does not implement <dialog>'s showModal/close; ConfirmDialog needs them.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

// Token var() strings rather than hex so lint:tokens stays clean.
function label(overrides: Partial<DBIssueLabel>): DBIssueLabel {
  return {
    color: 'var(--info)',
    createdAt: '2026-01-01T00:00:00Z',
    id: 'l',
    isGroup: false,
    name: 'Label',
    organizationId: 'org',
    teamId: 'team-1',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const OWN = label({ id: 'own', name: 'Bug', teamId: 'team-1' });
const WORKSPACE = label({ id: 'ws', name: 'Feature', teamId: null });
const OTHER = label({ id: 'other', name: 'Other team', teamId: 'team-2' });
const ARCHIVED = label({ archivedAt: '2026-02-01T00:00:00Z', id: 'gone', name: 'Old' });

beforeEach(() => {
  gqlMutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  storeHolder.current = new RootStore();
  runInAction(() => {
    storeHolder.current.labelStore.upsertMany([OWN, WORKSPACE, OTHER, ARCHIVED]);
  });
});

describe('labelsForTeam', () => {
  it('keeps own and workspace labels, drops other teams and archived rows', () => {
    const ids = labelsForTeam([OWN, WORKSPACE, OTHER, ARCHIVED], 'team-1').map(l => l.id);
    expect(ids).toEqual(['own', 'ws']);
  });
});

describe('TeamLabelsSection', () => {
  it('lists the scoped labels and badges the workspace one', () => {
    render(<TeamLabelsSection teamId="team-1" />);
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
    expect(screen.queryByText('Other team')).not.toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
    expect(screen.getAllByText('settings.team.labels.workspaceScope')).toHaveLength(1);
  });

  it('renders the empty state when nothing is scoped to the team', () => {
    // Only another team's label remains — the workspace one would still show.
    runInAction(() => {
      storeHolder.current.labelStore.pool.clear();
      storeHolder.current.labelStore.upsertMany([OTHER]);
    });
    render(<TeamLabelsSection teamId="team-1" />);
    expect(screen.getByText('settings.team.labels.emptyTitle')).toBeInTheDocument();
    expect(screen.queryByText('Other team')).not.toBeInTheDocument();
  });

  it('creates a label scoped to the team and adds it to the store', async () => {
    const created = label({ id: 'new', name: 'Docs', teamId: 'team-1' });
    gqlMutate.mockResolvedValueOnce({ issueLabelCreate: { issueLabel: created, success: true } });
    render(<TeamLabelsSection teamId="team-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.team.labels.add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'settings.team.labels.name' }), {
      target: { value: 'Docs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.team.labels.add' }));

    await waitFor(() => expect(gqlMutate).toHaveBeenCalledTimes(1));
    const [, variables] = gqlMutate.mock.calls[0] as [string, { input: Record<string, unknown> }];
    expect(variables.input).toMatchObject({ name: 'Docs', teamId: 'team-1' });
    expect(typeof variables.input.color).toBe('string');
    await waitFor(() => expect(storeHolder.current.labelStore.findById('new')).not.toBeNull());
    expect(toast.success).toHaveBeenCalledWith('settings.team.labels.created:Docs');
  });

  it('archives through the confirm dialog and hides the row', async () => {
    gqlMutate.mockResolvedValueOnce({
      issueLabelArchive: { issueLabel: { ...OWN, archivedAt: '2026-03-01T00:00:00Z' } },
    });
    render(<TeamLabelsSection teamId="team-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.team.labels.archiveAria:Bug' }));
    // Nothing is sent until the dialog is confirmed.
    expect(gqlMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'customFields.archive' }));

    await waitFor(() => expect(gqlMutate).toHaveBeenCalledWith(expect.any(String), { id: 'own' }));
    await waitFor(() => expect(screen.queryByText('Bug')).not.toBeInTheDocument());
  });
});
