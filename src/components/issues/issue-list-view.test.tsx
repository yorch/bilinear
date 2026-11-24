import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IssueListView } from './issue-list-view';
import type { IssueRowData } from './issue-row';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
const { barProps } = vi.hoisted(() => ({
  barProps: { current: {} as Record<string, unknown> },
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
vi.mock('./bulk-action-bar', () => ({
  BulkActionBar: (props: Record<string, unknown>) => {
    barProps.current = props;
    return <div data-testid="bulk" />;
  },
}));
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

  it('wires Delete into the bulk bar only when the page can bulk-delete, and clears after', () => {
    const onDeleteMany = vi.fn();
    const { unmount } = renderList({ onDeleteMany });
    fireEvent.keyDown(window, { key: 'x' });
    act(() => (barProps.current.onDelete as () => void)());
    expect(onDeleteMany).toHaveBeenCalledWith(['B']);
    expect(screen.queryByTestId('bulk')).toBeNull();
    unmount();

    renderList();
    fireEvent.keyDown(window, { key: 'x' });
    expect(barProps.current.onDelete).toBeUndefined();
  });

  it('hands the bar the page team, and on a multi-team page only a shared team', () => {
    const { unmount } = renderList({ teamId: 'T1' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(barProps.current.teamId).toBe('T1');
    expect(barProps.current.mixedTeams).toBe(false);
    unmount();

    const issues = [
      issue('A', { teamId: 'T1' }),
      issue('B', { teamId: 'T1' }),
      issue('C', { teamId: 'T2' }),
    ];
    const view = renderList({ issues });
    fireEvent.keyDown(window, { key: 'x' }); // B only
    expect(barProps.current.teamId).toBe('T1');
    expect(barProps.current.mixedTeams).toBe(false);
    fireEvent.click(screen.getByLabelText('check-C'));
    expect(barProps.current.teamId).toBeUndefined();
    expect(barProps.current.mixedTeams).toBe(true);
    view.unmount();
  });

  it('pads the list while a selection exists so the fixed bar cannot cover the last rows', () => {
    renderList();
    expect(screen.getByTestId('issue-list-view').className).not.toContain('pb-24');
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByTestId('issue-list-view').className).toContain('pb-24');
  });

  it('announces the cursor row politely, with its place in the drawn order', () => {
    renderList({ groupBy: 'none' });
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe(
      'issues.cursorAnnouncement:{"identifier":"B","position":2,"title":"B","total":3}',
    );
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

describe('IssueListView project / cycle / label grouping', () => {
  const headers = () =>
    screen
      .queryAllByRole('button')
      .map(b => b.textContent ?? '')
      .filter(Boolean);

  it('groups by project, with a trailing "no project" section', () => {
    renderList({
      groupBy: 'project',
      issues: [
        issue('A', { projectId: 'p1' }),
        issue('B', { projectId: 'p2' }),
        issue('C', { projectId: null }),
      ],
      projects: [
        { id: 'p1', name: 'Alpha' },
        { id: 'p2', name: 'Beta' },
      ],
    });
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'));
    expect(text.indexOf('Beta')).toBeLessThan(text.indexOf('issues.noProject'));
    expect(headers().length).toBeGreaterThan(0);
  });

  it('keeps an issue whose project is not loaded under "no project" rather than dropping it', () => {
    renderList({
      groupBy: 'project',
      issues: [issue('A', { projectId: 'gone' })],
      projects: [],
    });
    expect(screen.getByText('issues.noProject')).toBeTruthy();
    expect(screen.getAllByTestId('row')).toHaveLength(1);
  });

  it('groups by cycle', () => {
    renderList({
      cycles: [{ id: 'c1', label: 'Cycle 1' }],
      groupBy: 'cycle',
      issues: [issue('A', { cycleId: 'c1' }), issue('B', { cycleId: null })],
    });
    expect(screen.getByText('Cycle 1')).toBeTruthy();
    expect(screen.getByText('issues.noCycle')).toBeTruthy();
  });

  it('groups by first label and draws each issue exactly once', () => {
    const bug = { color: 'c', id: 'l1', name: 'Bug' };
    const feat = { color: 'c', id: 'l2', name: 'Feature' };
    renderList({
      groupBy: 'label',
      issues: [
        issue('A', { labels: [feat, bug] }),
        issue('B', { labels: [bug] }),
        issue('C', { labels: [] }),
      ],
    });
    expect(screen.getAllByTestId('row')).toHaveLength(3);
    expect(screen.getByText('Bug')).toBeTruthy();
    expect(screen.getByText('Feature')).toBeTruthy();
    expect(screen.getByText('issues.noLabel')).toBeTruthy();
  });
});
