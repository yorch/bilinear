import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnKey } from '@/hooks/use-visible-columns';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { IssueRow, type IssueRowData } from './issue-row';

// The row pulls translations from LocaleProvider and pending state from the
// TransactionQueue singleton. Neither is what these tests are about, so stub
// both rather than standing up the whole provider tree.
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatDate: (v: string) => v }),
}));

const pending = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-pending-ids', () => ({
  usePending: () => pending.value,
}));

vi.mock('../properties/assignee-select', () => ({
  AssigneeSelect: () => <span data-cell="assignee" />,
}));
vi.mock('../properties/cycle-select', () => ({ CycleSelect: () => <span data-cell="cycle" /> }));
vi.mock('../properties/due-date-picker', () => ({ DueDatePicker: () => <span data-cell="due" /> }));
vi.mock('../properties/estimate-picker', () => ({
  EstimatePicker: () => <span data-cell="estimate" />,
}));
vi.mock('../properties/label-select', () => ({ LabelSelect: () => <span data-cell="labels" /> }));
vi.mock('../properties/priority-select', () => ({
  PrioritySelect: () => <span data-cell="priority" />,
}));
vi.mock('../properties/status-select', () => ({ StatusSelect: () => <span data-cell="status" /> }));

const issue: IssueRowData = {
  assigneeId: null,
  cycleId: null,
  dueDate: null,
  estimate: null,
  id: 'issue-1',
  identifier: 'ENG-142',
  labels: [],
  priority: 1,
  stateId: 'state-1',
  title: 'Delta sync skips rows when committed_at ordering ties',
};

function customField(id: string): DBCustomFieldDefinition {
  return { id, name: `Field ${id}`, type: 'text' } as DBCustomFieldDefinition;
}

function renderRow(props: Partial<React.ComponentProps<typeof IssueRow>> = {}) {
  const { container } = render(
    <IssueRow
      allLabels={[]}
      issue={issue}
      onOpen={() => {}}
      onSelect={() => {}}
      onUpdate={() => {}}
      selected={false}
      states={[]}
      users={[]}
      {...props}
    />,
  );
  const row = container.querySelector('[data-testid="issue-row"]') as HTMLElement;
  return { row };
}

function trackCount(row: HTMLElement): number {
  // `minmax(0, 1fr)` contains a comma+space, so a naive split on whitespace
  // would over-count it. Collapse it to a single token first.
  return row.style.gridTemplateColumns
    .replace(/minmax\([^)]*\)/g, 'minmax')
    .trim()
    .split(/\s+/).length;
}

describe('IssueRow grid alignment', () => {
  /**
   * The whole point of the template: every cell must have exactly one track.
   * If they ever diverge — a column rendered without a matching track, or a
   * track left behind after a column was removed — the grid silently reflows
   * and the property columns stop lining up between rows, which is the exact
   * defect the template replaced.
   */
  it('declares exactly one track per rendered cell', () => {
    const { row } = renderRow();
    expect(trackCount(row)).toBe(row.children.length);
  });

  it('keeps tracks and cells in step as columns are hidden', () => {
    const hidden = new Set<ColumnKey>(['labels', 'cycle']);
    const { row } = renderRow({
      isColumnVisible: (key: ColumnKey) => !hidden.has(key),
      teamId: 'team-1',
    });
    expect(trackCount(row)).toBe(row.children.length);
    expect(row.querySelector('[data-cell="labels"]')).toBeNull();
    expect(row.querySelector('[data-cell="cycle"]')).toBeNull();
  });

  it('keeps tracks and cells in step with custom-field columns', () => {
    const defs = [customField('a'), customField('b')];
    const { row } = renderRow({
      customFields: defs,
      getCustomFieldValue: () => 'value',
      // Only one of the two custom fields is switched on.
      isColumnVisible: (key: ColumnKey) => key !== 'custom:b',
    });
    expect(trackCount(row)).toBe(row.children.length);
  });

  it('only renders the cycle column when the row belongs to a team', () => {
    const withTeam = renderRow({ teamId: 'team-1' });
    const withoutTeam = renderRow();
    expect(withTeam.row.querySelector('[data-cell="cycle"]')).not.toBeNull();
    expect(withoutTeam.row.querySelector('[data-cell="cycle"]')).toBeNull();
    expect(trackCount(withoutTeam.row)).toBe(withoutTeam.row.children.length);
  });

  it('only renders the estimate column when the team estimates', () => {
    expect(
      renderRow({ estimationType: 'points' }).row.querySelector('[data-cell="estimate"]'),
    ).not.toBeNull();
    expect(
      renderRow({ estimationType: 'notUsed' }).row.querySelector('[data-cell="estimate"]'),
    ).toBeNull();
  });

  /**
   * The pending-write dot used to be rendered conditionally mid-row, so an
   * in-flight write shifted that row's title sideways relative to its
   * neighbours. The slot is now always present and only its contents change.
   */
  it('reserves the pending-write slot whether or not a write is in flight', () => {
    pending.value = false;
    const idle = renderRow();
    const idleCells = idle.row.children.length;
    const idleTemplate = idle.row.style.gridTemplateColumns;

    pending.value = true;
    const busy = renderRow();

    expect(busy.row.children.length).toBe(idleCells);
    expect(busy.row.style.gridTemplateColumns).toBe(idleTemplate);
    expect(busy.row.querySelector('[role="status"]')).not.toBeNull();
    expect(idle.row.querySelector('[role="status"]')).toBeNull();

    pending.value = false;
  });
});
