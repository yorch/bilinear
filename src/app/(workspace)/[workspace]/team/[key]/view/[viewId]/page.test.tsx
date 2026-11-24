import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const captured: { builder?: Record<string, unknown>; list?: { issues: { id: string }[] } } = {};

vi.mock('next/navigation', () => ({
  useParams: () => ({ key: 'ENG', viewId: 'v1', workspace: 'acme' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/hooks/use-document-title', () => ({ useDocumentTitle: () => undefined }));
vi.mock('@/hooks/use-issue-update', () => ({ useIssueUpdate: () => vi.fn() }));
vi.mock('@/hooks/use-issues-bulk-update', () => ({ useIssuesBulkUpdate: () => vi.fn() }));
vi.mock('@/hooks/use-issue-list-page', () => ({
  useIssueListPage: ({ issues }: { issues: unknown }) => ({
    boardGroupBy: 'status',
    closeDetail: vi.fn(),
    deleteDialogProps: {},
    detailIssue: null,
    handleArchive: vi.fn(),
    handleArchiveMany: vi.fn(),
    handleDeleteMany: vi.fn(),
    handleOpen: vi.fn(),
    issues,
    openProperty: null,
    requestDelete: vi.fn(),
    selectedId: null,
    setBoardGroupBy: vi.fn(),
    setOpenProperty: vi.fn(),
    setSelectedId: vi.fn(),
    setSwimlaneBy: vi.fn(),
    setViewMode: vi.fn(),
    swimlaneBy: 'none',
    viewMode: 'list',
  }),
}));
vi.mock('@/components/issues/filter-builder', () => ({
  FilterBuilder: (props: Record<string, unknown>) => {
    captured.builder = props;
    return null;
  },
}));
vi.mock('@/components/issues/issue-list-view', () => ({
  IssueListView: (props: { issues: { id: string }[] }) => {
    captured.list = props;
    return null;
  },
}));
vi.mock('@/components/issues/board-controls', () => ({ BoardControls: () => null }));
vi.mock('@/components/issues/board-view', () => ({ BoardView: () => null }));
vi.mock('@/components/issues/lazy-issue-detail-panel', () => ({
  LazyIssueDetailPanel: () => null,
}));
vi.mock('@/components/issues/list-display-controls', () => ({
  ALL_GROUP_OPTIONS: [],
  ListDisplayControls: () => null,
}));
vi.mock('@/components/issues/view-toggle', () => ({ ViewToggle: () => null }));
vi.mock('@/components/layouts/favorite-toggle', () => ({ FavoriteToggle: () => null }));
vi.mock('@/components/roadmap/gantt-view', () => ({ GanttView: () => null }));
vi.mock('@/components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/shared/prompt-dialog', () => ({ PromptDialog: () => null }));

const PAST = '2020-01-01';
const issue = (id: string, stateId: string) => ({
  assigneeId: null,
  createdAt: '2020-01-01T00:00:00.000Z',
  cycleId: null,
  dueDate: PAST,
  id,
  identifier: id,
  labels: [],
  priority: 0,
  projectId: null,
  sortOrder: 1,
  stateId,
  teamId: 't1',
  title: id,
  updatedAt: '2020-01-01T00:00:00.000Z',
});

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    customFieldStore: { findDefinitionsByTeamId: () => [], findValue: () => null },
    customViewStore: {
      findById: () => ({
        filters: { composition: 'and', conditions: [{ field: 'dueDate', operator: 'overdue' }] },
        id: 'v1',
        layout: 'list',
        name: 'Overdue',
      }),
    },
    cycleStore: {
      all: [{ id: 'c1', name: 'Sprint 1', number: 1, teamId: 't1' }],
      findByTeamId: () => [{ id: 'c1', name: 'Sprint 1', number: 1, teamId: 't1' }],
    },
    issueStore: { findByTeamId: () => [issue('open', 's-todo'), issue('done', 's-done')] },
    labelStore: { all: [] },
    projectStore: { all: [{ id: 'p1', name: 'Apollo' }] },
    syncStore: { status: 'ready' },
    teamStore: {
      findByKey: () => ({ id: 't1', issueEstimationType: 'tShirt', key: 'ENG', name: 'Eng' }),
    },
    uiStore: { openCreateIssueModal: vi.fn() },
    userStore: { all: [] },
    workflowStateStore: {
      findByTeamId: () => [
        { id: 's-todo', name: 'Todo', position: 1, type: 'unstarted' },
        { id: 's-done', name: 'Done', position: 2, type: 'completed' },
      ],
    },
  }),
}));

const { default: CustomViewPage } = await import('./page');

describe('saved view page', () => {
  it('does not count a Done issue as overdue (filter context is passed)', () => {
    render(<CustomViewPage />);
    expect(captured.list?.issues.map(i => i.id)).toEqual(['open']);
  });

  it('gives the filter builder the cycle/project lookups and estimation scale', () => {
    render(<CustomViewPage />);
    expect(captured.builder?.cycles).toEqual([{ id: 'c1', label: expect.any(String), number: 1 }]);
    expect(captured.builder?.projects).toEqual([{ id: 'p1', name: 'Apollo' }]);
    expect(captured.builder?.estimationType).toBe('tShirt');
  });
});
