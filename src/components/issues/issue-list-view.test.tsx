import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IssueListView } from './issue-list-view';
import type { IssueRowData } from './issue-row';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('./issue-row', () => ({
  IssueRow: ({
    issue,
    checked,
    onCheck,
    selected,
  }: {
    issue: IssueRowData;
    checked?: boolean;
    onCheck?: (shiftKey: boolean) => void;
    selected: boolean;
  }) => (
    <div
      data-checked={checked ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-testid="row"
    >
      {issue.identifier}
      <input
        aria-label={`check-${issue.id}`}
        checked={checked ?? false}
        onChange={() => {}}
        onClick={e => onCheck?.(e.shiftKey)}
        type="checkbox"
      />
    </div>
  ),
}));
vi.mock('./issue-context-menu', () => ({ IssueContextMenu: () => null }));
vi.mock('./bulk-action-bar', () => ({ BulkActionBar: () => <div data-testid="bulk" /> }));
vi.mock('@/components/properties/status-select', () => ({ StatusDot: () => <i /> }));
vi.mock('@/components/properties/priority-icon', () => ({
  PriorityIcon: () => <i />,
  priorityLabelKey: (p: number) => `p${p}`,
}));

const states = [
  { color: 'c', id: 's1', name: 'Todo', type: 'unstarted' },
  { color: 'c', id: 's2', name: 'Done', type: 'completed' },
] as never;

function issue(id: string, patch: Partial<IssueRowData> = {}): IssueRowData {
  return { id, identifier: id, labels: [], priority: 0, stateId: 's1', title: id, ...patch };
}

function renderList(props: Partial<React.ComponentProps<typeof IssueListView>> = {}) {
  return render(
    <IssueListView
      issues={[
        issue('A', { priority: 0 }),
        issue('B', { priority: 1 }),
        issue('C', { priority: 3 }),
      ]}
      labels={[]}
      onBulkUpdate={() => {}}
      onOpen={() => {}}
      onSelect={() => {}}
      onUpdate={() => {}}
      selectedId="B"
      states={states}
      users={[]}
      {...props}
    />,
  );
}

describe('IssueListView', () => {
  it('says "no match" with a clear action (not "press C") when filters empty the list', () => {
    const onClearFilters = vi.fn();
    renderList({ hasActiveFilters: true, issues: [], onClearFilters });
    expect(screen.getByText('issues.noIssuesMatchFilters')).toBeTruthy();
    expect(screen.queryByText('issues.noIssues')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'issues.clearFilters' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('keeps the create-an-issue copy when nothing is filtered', () => {
    renderList({ issues: [] });
    expect(screen.getByText('issues.noIssues')).toBeTruthy();
  });

  it('groups by priority with Urgent first and No priority last', () => {
    renderList({ groupBy: 'priority' });
    // header text is "<name><count>"; each group holds one issue
    const headers = screen.getAllByTestId('group-header').map(h => h.textContent);
    expect(headers).toEqual(['p11', 'p31', 'p01']);
  });

  it('renders one headerless list when grouping is off', () => {
    renderList({ groupBy: 'none' });
    expect(screen.queryAllByTestId('group-header')).toHaveLength(0);
    expect(screen.getAllByTestId('row')).toHaveLength(3);
  });

  it('x checks the cursor row and x again unchecks it', () => {
    renderList();
    const rowB = () => screen.getAllByTestId('row').find(r => r.textContent === 'B');
    expect(rowB()?.dataset.checked).toBe('false');
    fireEvent.keyDown(window, { key: 'x' });
    expect(rowB()?.dataset.checked).toBe('true');
    fireEvent.keyDown(window, { key: 'x' });
    expect(rowB()?.dataset.checked).toBe('false');
  });

  it('Escape clears the checked set and claims the event', () => {
    renderList();
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByTestId('bulk')).toBeTruthy();
    const pageHandler = vi.fn();
    window.addEventListener('keydown', pageHandler);
    const notCancelled = fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', pageHandler);
    expect(screen.queryByTestId('bulk')).toBeNull();
    // Claimed: preventDefault'd and never reached the page-level listener.
    expect(notCancelled).toBe(false);
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it('shift-range select follows the drawn (grouped) order, not the array order', () => {
    // Array order: A(p1) B(p2) C(p1) D(p2). Grouped by priority the list draws
    // A, C | B, D, so a range from A to C must not sweep up B.
    renderList({
      groupBy: 'priority',
      issues: [
        issue('A', { priority: 1 }),
        issue('B', { priority: 2 }),
        issue('C', { priority: 1 }),
        issue('D', { priority: 2 }),
      ],
    });
    fireEvent.click(screen.getByLabelText('check-A'));
    fireEvent.click(screen.getByLabelText('check-C'), { shiftKey: true });
    const checked = screen
      .getAllByTestId('row')
      .filter(r => r.dataset.checked === 'true')
      .map(r => r.textContent);
    expect(checked).toEqual(['A', 'C']);
  });
});
