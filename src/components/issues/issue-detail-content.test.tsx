import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailContent } from './issue-detail-content';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({
    formatDate: (v: unknown) => String(v),
    formatDueDate: (v: string) => `fmt(${v.slice(0, 10)})`,
    intlLocale: 'en-US',
  }),
}));

const emptyStore = {
  all: [],
  findById: () => null,
  findByTeamId: () => [],
  pool: new Map(),
};
vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    cycleStore: emptyStore,
    issueStore: emptyStore,
    labelStore: emptyStore,
    projectStore: emptyStore,
    teamStore: { findById: () => ({ issueEstimationType: 'fibonacci' }) },
    userStore: { currentUser: null, ...emptyStore },
  }),
}));

// The sections below the property rail are not under test and pull in the
// network, the editor and the transaction queue.
vi.mock('@/components/editor/tiptap-editor.lazy', () => ({ TipTapEditor: () => null }));
vi.mock('@/components/custom-fields/custom-fields-editor', () => ({
  CustomFieldsEditor: () => null,
}));
vi.mock('@/components/properties/assignee-select', () => ({ AssigneeSelect: () => null }));
vi.mock('@/components/properties/label-select', () => ({ LabelSelect: () => null }));
vi.mock('@/components/properties/milestone-select', () => ({ MilestoneSelect: () => null }));
vi.mock('@/components/properties/status-select', () => ({ StatusSelect: () => null }));
vi.mock('@/components/properties/priority-select', () => ({ PrioritySelect: () => null }));
vi.mock('./activity-timeline', () => ({ ActivityTimeline: () => null }));
vi.mock('./ai-insights', () => ({ AiInsights: () => null }));
vi.mock('./comment-thread', () => ({ CommentThread: () => null }));
vi.mock('./file-attachments', () => ({ FileAttachments: () => null }));
vi.mock('./issue-picker', () => ({ IssuePicker: () => null }));
vi.mock('./issue-reaction-bar', () => ({ IssueReactionBar: () => null }));
vi.mock('./issue-reminder-chip', () => ({ IssueReminderChip: () => null }));
vi.mock('./pull-requests-section', () => ({ PullRequestsSection: () => null }));
vi.mock('./relations-section', () => ({ RelationsSection: () => null }));
vi.mock('./sub-issue-list', () => ({ SubIssueList: () => null }));

afterEach(cleanup);

const issue = {
  cycleId: null,
  description: '',
  dueDate: '2026-11-25T00:00:00.000Z',
  estimate: 3,
  id: 'i1',
  identifier: 'ENG-1',
  labels: [],
  priority: 0,
  projectId: null,
  startDate: '2026-11-20',
  stateId: 's1',
  teamId: 't1',
  title: 'Title',
} as never;

const renderContent = (layout: 'page' | 'panel') =>
  render(
    <IssueDetailContent
      issue={issue}
      labels={[]}
      layout={layout}
      onUpdate={vi.fn()}
      states={[{ id: 's1', type: 'started' } as never]}
      users={[]}
    />,
  );

const FIELDS = [
  'issueDetail.properties.project',
  'issueDetail.properties.cycle',
  'issueDetail.properties.startDate',
  'issueDetail.properties.dueDate',
  'issueDetail.properties.estimate',
];

describe('IssueDetailContent property labels', () => {
  it('panel layout: every field name appears exactly once (the row label, no chip repeat)', () => {
    const { container } = renderContent('panel');
    for (const name of FIELDS) {
      expect(within(container).getAllByText(name), name).toHaveLength(1);
    }
  });

  it('page layout: the row label is hidden below lg and the chip carries the name instead', () => {
    const { container } = renderContent('page');
    for (const name of FIELDS) {
      const hits = within(container).getAllByText(name);
      expect(hits, name).toHaveLength(2);
      expect(
        hits.some(h => h.className.includes('max-lg:hidden')),
        name,
      ).toBe(true);
      expect(
        hits.some(h => h.className.includes('lg:hidden')),
        name,
      ).toBe(true);
    }
  });

  const day = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('the due-date picker refuses a day before the start date', () => {
    renderContent('page');
    fireEvent.click(
      screen.getByRole('button', { name: /properties\.dueDate .*fmt\(2026-11-25\)/ }),
    );
    expect(day('Thursday, November 19, 2026').disabled).toBe(true);
    expect(day('Friday, November 20, 2026').disabled).toBe(false);
  });

  it('the start-date picker refuses a day after the due date', () => {
    renderContent('page');
    fireEvent.click(
      screen.getByRole('button', { name: /properties\.startDate .*fmt\(2026-11-20\)/ }),
    );
    expect(day('Wednesday, November 25, 2026').disabled).toBe(false);
    expect(day('Thursday, November 26, 2026').disabled).toBe(true);
  });
});
