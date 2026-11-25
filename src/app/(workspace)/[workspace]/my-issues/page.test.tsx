import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured: {
  board?: { issues: { id: string }[] };
  builder?: Record<string, unknown>;
  list?: { issues: { id: string }[] };
} = {};
let viewMode: 'list' | 'board' = 'list';

vi.mock('next/navigation', () => ({ useParams: () => ({ workspace: 'acme' }) }));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/hooks/use-document-title', () => ({ useDocumentTitle: () => undefined }));
vi.mock('@/hooks/use-issue-update', () => ({ useIssueUpdate: () => vi.fn() }));
vi.mock('@/hooks/use-issues-bulk-update', () => ({ useIssuesBulkUpdate: () => vi.fn() }));
vi.mock('@/hooks/use-retryable-fetch', () => ({
  useRetryableFetch: () => ({ data: null, error: false, loading: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/use-issue-list-page', () => ({
  useIssueListPage: ({ issues }: { issues: (m: string) => unknown }) => ({
    boardGroupBy: 'status',
    closeDetail: vi.fn(),
    deleteDialogProps: {},
    detailIssue: null,
    handleArchive: vi.fn(),
    handleArchiveMany: vi.fn(),
    handleDeleteMany: vi.fn(),
    handleOpen: vi.fn(),
    issues: issues(viewMode),
    openProperty: null,
    requestDelete: vi.fn(),
    selectedId: null,
    setBoardGroupBy: vi.fn(),
    setOpenProperty: vi.fn(),
    setSelectedId: vi.fn(),
    setSwimlaneBy: vi.fn(),
    setViewMode: vi.fn(),
    swimlaneBy: 'none',
    viewMode,
  }),
}));
vi.mock('@/components/issues/filter-builder', () => ({
  FilterBuilder: (p: Record<string, unknown>) => {
    captured.builder = p;
    return null;
  },
}));
vi.mock('@/components/issues/issue-list-view', () => ({
  IssueListView: (p: { issues: { id: string }[] }) => {
    captured.list = p;
    return null;
  },
}));
vi.mock('@/components/issues/board-view', () => ({
  BoardView: (p: { issues: { id: string }[] }) => {
    captured.board = p;
    return null;
  },
}));
vi.mock('@/components/issues/list-display-controls', () => ({
  ALL_GROUP_OPTIONS: [],
  ListDisplayControls: () => null,
}));
vi.mock('@/components/issues/board-controls', () => ({ BoardControls: () => null }));
vi.mock('@/components/issues/lazy-issue-detail-panel', () => ({
  LazyIssueDetailPanel: () => null,
}));
vi.mock('@/components/issues/view-toggle', () => ({ ViewToggle: () => null }));
vi.mock('@/components/roadmap/gantt-view', () => ({ GanttView: () => null }));
vi.mock('@/components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }));

const OLD = '2020-01-01T00:00:00.000Z';
const mine = (id: string, stateId: string, extra: Record<string, unknown> = {}) => ({
  assigneeId: 'me',
  createdAt: OLD,
  id,
  identifier: id,
  labels: [],
  priority: 0,
  sortOrder: 1,
  stateId,
  teamId: 't1',
  title: id,
  updatedAt: OLD,
  ...extra,
});
const POOL = new Map(
  [mine('open', 's-todo'), mine('old-done', 's-done', { completedAt: OLD })].map(i => [i.id, i]),
);
const STATES = [
  { id: 's-todo', name: 'Todo', position: 1, teamId: 't1', type: 'unstarted' },
  { id: 's-done', name: 'Done', position: 2, teamId: 't1', type: 'completed' },
];
const TEAMS = [
  { id: 't1', issueEstimationType: 'tShirt', key: 'ENG' },
  { id: 't2', issueEstimationType: 'fibonacci', key: 'OPS' },
];

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    cycleStore: { all: [] },
    issueStore: { pool: POOL },
    labelStore: { all: [], pool: new Map() },
    projectStore: { all: [] },
    syncStore: { status: 'ready' },
    teamStore: {
      all: TEAMS,
      findById: (id: string) => TEAMS.find(t => t.id === id),
      pool: new Map(),
    },
    uiStore: { openCreateIssueModal: vi.fn() },
    userStore: { all: [], currentUser: { id: 'me' }, pool: new Map() },
    workflowStateStore: {
      all: STATES,
      findByTeamId: (id: string) => STATES.filter(s => s.teamId === id),
      pool: new Map(),
    },
  }),
}));

const { default: MyIssuesPage } = await import('./page');

beforeEach(() => {
  for (const k of Object.keys(captured)) {
    delete (captured as Record<string, unknown>)[k];
  }
  viewMode = 'list';
  window.localStorage.clear();
  window.localStorage.setItem(
    'bilinear:listDisplay:v1:my-issues',
    JSON.stringify({ completed: 'none' }),
  );
});

describe('my issues page', () => {
  it('hides completed issues in list mode', () => {
    render(<MyIssuesPage />);
    expect(captured.list?.issues.map(i => i.id)).toEqual(['open']);
  });

  it('keeps completed issues on the board, which has no control to bring them back', () => {
    viewMode = 'board';
    render(<MyIssuesPage />);
    expect(captured.board?.issues.map(i => i.id).sort()).toEqual(['old-done', 'open']);
  });

  it('flags mixed estimation scales to the filter builder', () => {
    render(<MyIssuesPage />);
    expect(captured.builder?.estimateScaleMixed).toBe(true);
  });
});
