import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubIssueList } from './sub-issue-list';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/transaction-queue', () => ({ TransactionQueue: class {} }));

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

const issues = [
  {
    ...baseIssue,
    id: 'p',
    identifier: 'ENG-1',
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
    workflowStateStore: { findById: (id: string) => states[id], pool: new Map() },
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
});
