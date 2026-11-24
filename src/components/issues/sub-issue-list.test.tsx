import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubIssueList } from './sub-issue-list';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/transaction-queue', () => ({ TransactionQueue: class {} }));

const updateIssueSpy = vi.fn();
vi.mock('@/hooks/use-issue-update', () => ({ useIssueUpdate: () => updateIssueSpy }));

// Render the picker as one button per offered candidate so the test sees exactly
// which issues survive the exclusion set and exercises the real onSelect.
vi.mock('@/components/issues/issue-picker', () => ({
  IssuePicker: (props: {
    excludeId?: string;
    excludeIds?: ReadonlySet<string>;
    onSelect: (i: { id: string }) => void;
  }) => (
    <div data-testid="picker">
      {issues
        .filter(i => i.id !== props.excludeId && !props.excludeIds?.has(i.id))
        .map(i => (
          <button key={i.id} onClick={() => props.onSelect(i)} type="button">
            {`offer:${i.id}`}
          </button>
        ))}
    </div>
  ),
}));

vi.mock('@/hooks/use-issue-create', () => ({ useIssueCreate: () => async () => undefined }));

const baseIssue = {
  createdAt: '',
  labelIds: [],
  number: 1,
  organizationId: 'o',
  prioritySortOrder: 0,
  sortOrder: 0,
  teamId: 't1',
  trashed: false,
  updatedAt: '',
};

const issues: Array<Record<string, unknown> & { id: string }> = [
  {
    ...baseIssue,
    id: 'g',
    identifier: 'ENG-10',
    parentId: 'gg',
    priority: 0,
    stateId: 's-started',
    title: 'Grandparent',
  },
  {
    ...baseIssue,
    id: 'gg',
    identifier: 'ENG-11',
    priority: 0,
    stateId: 's-started',
    title: 'Great-grandparent',
  },
  {
    ...baseIssue,
    id: 'gc',
    identifier: 'ENG-12',
    parentId: 'c1',
    priority: 0,
    stateId: 's-started',
    title: 'Grandchild',
  },
  {
    ...baseIssue,
    id: 'x',
    identifier: 'ENG-13',
    priority: 0,
    stateId: 's-started',
    title: 'Unrelated',
  },
  {
    ...baseIssue,
    id: 'p',
    identifier: 'ENG-1',
    parentId: 'g',
    priority: 0,
    stateId: 's-started',
    title: 'Parent',
  },
  {
    ...baseIssue,
    id: 'c1',
    identifier: 'ENG-2',
    parentId: 'p',
    priority: 0,
    stateId: 's-triage',
    title: 'Triage child',
  },
  {
    ...baseIssue,
    id: 'c2',
    identifier: 'ENG-3',
    parentId: 'p',
    priority: 0,
    stateId: 's-weird',
    title: 'Unknown-category child',
  },
];
const states: Record<string, { color: string; id: string; name: string; type: string }> = {
  's-started': { color: 'var(--info)', id: 's-started', name: 'Doing', type: 'started' },
  's-triage': { color: 'var(--warning)', id: 's-triage', name: 'Triage', type: 'triage' },
  's-weird': { color: 'var(--info)', id: 's-weird', name: 'Weird', type: 'somethingnew' },
};

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    issueStore: {
      findById: (id: string) => issues.find(i => i.id === id) ?? null,
      pool: new Map(issues.map(i => [i.id, i])),
    },
    teamStore: { findById: () => null },
    workflowStateStore: {
      findById: (id: string) => states[id],
      findByTeamId: () => [],
      pool: new Map(),
    },
  }),
}));

describe('SubIssueList', () => {
  it('lists children in the triage category and in unknown categories', () => {
    render(<SubIssueList parentIssueId="p" />);
    // The header counts both children…
    expect(screen.getByText('Triage child')).toBeInTheDocument();
    expect(screen.getByText('Unknown-category child')).toBeInTheDocument();
    // …under a labelled triage group.
    expect(screen.getByText('issueDetail.subIssues.categories.triage')).toBeInTheDocument();
  });

  it('offers an "Add existing" action next to "Add sub-issue"', () => {
    render(<SubIssueList parentIssueId="p" />);
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(screen.getByText('issueDetail.subIssues.addSubIssue')).toBeInTheDocument();
  });
});

describe('SubIssueList header on narrow screens', () => {
  it('collapses "Add existing" to an icon and hides the progress bar below sm', () => {
    const { container } = render(<SubIssueList parentIssueId="p" />);
    expect(container.querySelector('[role="progressbar"], .h-1')?.className).toContain(
      'max-sm:hidden',
    );
  });
});

describe('SubIssueList "Add existing" candidates', () => {
  it('excludes the parent, its ancestors and its direct children; offers deeper descendants and strangers', () => {
    updateIssueSpy.mockReset();
    render(<SubIssueList parentIssueId="p" />);
    const offered = screen
      .getAllByText(/^offer:/)
      .map(b => b.textContent?.replace('offer:', ''))
      .sort();
    // p (self), g + gg (ancestors), c1 + c2 (direct children) are hidden.
    expect(offered).toEqual(['gc', 'x']);
  });

  it('re-parents the picked issue under the parent', () => {
    updateIssueSpy.mockReset();
    render(<SubIssueList parentIssueId="p" />);
    fireEvent.click(screen.getByText('offer:gc'));
    expect(updateIssueSpy).toHaveBeenCalledWith('gc', { parentId: 'p' });
  });
});
