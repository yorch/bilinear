import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured: {
  board?: { issues: { id: string }[]; states: { id: string }[] };
  builder?: { states: { id: string }[] };
  controls?: Record<string, unknown>;
  list?: { issues: { id: string }[]; states: { id: string }[] };
  triageLink?: string;
} = {};
let viewMode: 'list' | 'board' = 'list';

vi.mock('next/navigation', () => ({
  useParams: () => ({ key: 'ENG', workspace: 'acme' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => {
    if (href.endsWith('/triage')) {
      captured.triageLink = String(children);
    }
    return <a href={href}>{children}</a>;
  },
}));
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${JSON.stringify(v)}` : k,
}));
vi.mock('@/hooks/use-document-title', () => ({ useDocumentTitle: () => undefined }));
vi.mock('@/hooks/use-recent-items', () => ({ useRecentItems: () => ({ addRecent: vi.fn() }) }));
vi.mock('@/hooks/use-visible-columns', () => ({
  useVisibleColumns: () => ({ isVisible: () => true, toggle: vi.fn() }),
}));
vi.mock('@/hooks/use-issue-update', () => ({ useIssueUpdate: () => vi.fn() }));
vi.mock('@/hooks/use-issues-bulk-update', () => ({ useIssuesBulkUpdate: () => vi.fn() }));
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
  FilterBuilder: (p: { states: { id: string }[] }) => {
    captured.builder = p;
    return null;
  },
}));
vi.mock('@/components/issues/issue-list-view', () => ({
  IssueListView: (p: { issues: { id: string }[]; states: { id: string }[] }) => {
    captured.list = p;
    return null;
  },
}));
vi.mock('@/components/issues/board-view', () => ({
  BoardView: (p: { issues: { id: string }[]; states: { id: string }[] }) => {
    captured.board = p;
    return null;
  },
}));
vi.mock('@/components/issues/list-display-controls', () => ({
  ALL_GROUP_OPTIONS: [],
  ListDisplayControls: (p: Record<string, unknown>) => {
    captured.controls = p;
    return null;
  },
}));
vi.mock('@/components/issues/board-controls', () => ({ BoardControls: () => null }));
vi.mock('@/components/issues/column-picker', () => ({ ColumnPicker: () => null }));
vi.mock('@/components/issues/csv-export-button', () => ({ CsvExportButton: () => null }));
vi.mock('@/components/issues/lazy-issue-detail-panel', () => ({
  LazyIssueDetailPanel: () => null,
}));
vi.mock('@/components/issues/view-toggle', () => ({ ViewToggle: () => null }));
vi.mock('@/components/roadmap/gantt-view', () => ({ GanttView: () => null }));
vi.mock('@/components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/views/save-view-modal', () => ({ SaveViewModal: () => null }));

const OLD = '2020-01-01T00:00:00.000Z';
const row = (id: string, stateId: string, extra: Record<string, unknown> = {}) => ({
  assigneeId: null,
  createdAt: OLD,
  cycleId: null,
  id,
  identifier: id,
  labels: [],
  priority: 0,
  projectId: null,
  sortOrder: 1,
  stateId,
  teamId: 't1',
  title: id,
  updatedAt: OLD,
  ...extra,
});
const SNOOZE_END = new Date(Date.now() + 3_600_000).toISOString();
const ISSUES = [
  row('open', 's-todo'),
  row('old-done', 's-done', { completedAt: OLD }),
  row('queued', 's-triage'),
  row('snoozed', 's-triage', { snoozedUntilAt: SNOOZE_END }),
];

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    customFieldStore: { findDefinitionsByTeamId: () => [], findValue: () => null },
    cycleStore: { all: [], findByTeamId: () => [], pool: new Map() },
    issueStore: { findByTeamId: () => ISSUES },
    labelStore: { all: [] },
    projectStore: { all: [], pool: new Map() },
    syncStore: { status: 'ready' },
    teamStore: {
      all: [{ id: 't1', key: 'ENG' }],
      findById: () => ({ id: 't1', key: 'ENG' }),
      findByKey: () => ({
        id: 't1',
        issueEstimationType: 'notUsed',
        key: 'ENG',
        name: 'Eng',
        triageEnabled: true,
      }),
    },
    uiStore: { openCreateIssueModal: vi.fn() },
    userStore: { all: [] },
    workflowStateStore: {
      findByTeamId: () => [
        { id: 's-triage', name: 'Triage', position: -1, type: 'triage' },
        { id: 's-todo', name: 'Todo', position: 1, type: 'unstarted' },
        { id: 's-done', name: 'Done', position: 2, type: 'completed' },
      ],
    },
  }),
}));

const { default: TeamIssuesPage } = await import('./page');

beforeEach(() => {
  for (const k of Object.keys(captured)) {
    delete (captured as Record<string, unknown>)[k];
  }
  viewMode = 'list';
  window.localStorage.clear();
  // The user chose to hide completed issues.
  window.localStorage.setItem('bilinear:listDisplay:v1:ENG', JSON.stringify({ completed: 'none' }));
});

describe('team issues page', () => {
  it('hides completed issues in list mode, where the control lives', () => {
    render(<TeamIssuesPage />);
    expect(captured.list?.issues.map(i => i.id)).toEqual(['open']);
  });

  it('does not apply the completed preference on the board, which has no control for it', () => {
    viewMode = 'board';
    render(<TeamIssuesPage />);
    expect(captured.board?.issues.map(i => i.id)).toContain('old-done');
  });

  it('drops the Triage state from the filter, board columns and list when triage is on', () => {
    viewMode = 'board';
    render(<TeamIssuesPage />);
    expect(captured.builder?.states.map(s => s.id)).toEqual(['s-todo', 's-done']);
    expect(captured.board?.states.map(s => s.id)).toEqual(['s-todo', 's-done']);
  });

  it('counts only un-snoozed triage issues in the queue link', () => {
    render(<TeamIssuesPage />);
    expect(captured.triageLink).toBe('issues.inTriageLink:{"count":1}');
  });
});
