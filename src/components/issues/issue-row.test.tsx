import { fireEvent, render } from '@testing-library/react';
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

describe('IssueRow bulk-selection modifier', () => {
  /**
   * `onCheck` reports whether Shift was held, and bulk lists use it to extend
   * the selection from the previous row.
   *
   * This was read as `(e.nativeEvent as MouseEvent).shiftKey` inside the
   * checkbox's `onChange`. A checkbox's change event is a plain `Event` with no
   * `shiftKey` property at all, so the expression evaluated to `undefined`
   * forever and shift-range selection never worked anywhere in the app — the
   * `as MouseEvent` cast is what stopped the type-checker from saying so. The
   * modifier now comes from the pointer/key event that precedes activation.
   */
  it('is a labelled group naming its issue, with aria-current on the cursor row only', () => {
    const { row } = renderRow({ selected: true });
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBe(`${issue.identifier} ${issue.title}`);
    expect(row.getAttribute('aria-current')).toBe('true');
    const { row: other } = renderRow({ selected: false });
    expect(other.hasAttribute('aria-current')).toBe(false);
  });

  it('reports Shift held during a pointer interaction', () => {
    const onCheck = vi.fn();
    const { row } = renderRow({ checked: false, onCheck });
    const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;

    fireEvent.click(box, { shiftKey: true });

    expect(onCheck).toHaveBeenCalledWith(true);
  });

  it('reports Shift held for keyboard activation', () => {
    const onCheck = vi.fn();
    const { row } = renderRow({ checked: false, onCheck });
    const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;

    // Space on a focused checkbox is dispatched by the browser as a click that
    // carries the current modifier state.
    fireEvent.click(box, { shiftKey: true });

    expect(onCheck).toHaveBeenCalledWith(true);
  });

  it('reports no modifier for a plain click', () => {
    const onCheck = vi.fn();
    const { row } = renderRow({ checked: false, onCheck });
    const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;

    fireEvent.click(box, { shiftKey: false });

    expect(onCheck).toHaveBeenCalledWith(false);
  });
});

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

  it('renders a number custom field with its stored format, and raw without one', () => {
    const formatted = {
      id: 'budget',
      name: 'Budget',
      options: { numberFormat: { currency: 'USD', decimals: 2, kind: 'currency' } },
      type: 'number',
    } as unknown as DBCustomFieldDefinition;
    const unformatted = { id: 'qty', name: 'Qty', type: 'number' } as DBCustomFieldDefinition;
    const { row } = renderRow({
      customFields: [formatted, unformatted],
      getCustomFieldValue: () => 1234.5,
      isColumnVisible: () => true,
    });
    expect(row.textContent).toContain('$1,234.50');
    expect(row.textContent).toContain('1234.5');
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

describe('IssueRow list-column and touch fixes', () => {
  it('shows one label chip plus a +N chip whose tooltip names them all', () => {
    const labels = [
      { color: 'c', id: 'l1', name: 'Feature' },
      { color: 'c', id: 'l2', name: 'Bug' },
      { color: 'c', id: 'l3', name: 'Infra' },
    ];
    const { row } = renderRow({ issue: { ...issue, labels } });
    const more = row.querySelector('[data-testid="issue-row-label-more"]') as HTMLElement;
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('title')).toBe('Feature, Bug, Infra');
  });

  it('shows no +N chip for a single label', () => {
    const { row } = renderRow({
      issue: { ...issue, labels: [{ color: 'c', id: 'l1', name: 'Bug' }] },
    });
    expect(row.querySelector('[data-testid="issue-row-label-more"]')).toBeNull();
  });

  it('renders the cycle as a short "C2" with the full name as the tooltip', () => {
    const { row } = renderRow({
      cycle: { label: 'Sprint 14 - Auth', number: 2 },
      issue: { ...issue, cycleId: 'c1' },
      teamId: 'team-1',
    });
    expect(row.querySelector('[data-testid="issue-row-cycle-short"]')?.textContent).toBe('C2');
    expect(row.querySelector('[title="Sprint 14 - Auth"]')).not.toBeNull();
  });

  it('gives the checkbox a 44px-below-md hit area that also toggles', () => {
    const onCheck = vi.fn();
    const { row } = renderRow({ checked: false, onCheck });
    const area = row.querySelector('[data-testid="issue-row-check-area"]') as HTMLElement;
    expect(area.className).toContain('max-md:h-11');
    expect(area.className).toContain('max-md:w-11');
    fireEvent.click(area, { shiftKey: true });
    expect(onCheck).toHaveBeenCalledWith(true);
    // Clicking the box itself must not double-fire through the wrapper.
    onCheck.mockClear();
    fireEvent.click(area.querySelector('input') as HTMLElement);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('marks the cursor row with aria-current', () => {
    expect(renderRow({ selected: true }).row.getAttribute('aria-current')).toBe('true');
    expect(renderRow({ selected: false }).row.hasAttribute('aria-current')).toBe(false);
  });
});
