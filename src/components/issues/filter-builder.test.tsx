import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FilterSet } from '@/lib/filter-engine';
import { FilterBuilder } from './filter-builder';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const base = {
  labels: [],
  onChange: () => {},
  states: [],
  users: [],
};

function set(condition: FilterSet['conditions'][number]): FilterSet {
  return { composition: 'and', conditions: [condition] };
}

describe('FilterPill value names', () => {
  it('shows the project name, not its id', () => {
    render(
      <FilterBuilder
        {...base}
        filterSet={set({ field: 'project', operator: 'eq', value: 'p-123' })}
        projects={[{ id: 'p-123', name: 'Public API v2' }]}
      />,
    );
    expect(screen.getByText('Public API v2')).toBeTruthy();
    expect(screen.queryByText('p-123')).toBeNull();
  });

  it('shows cycle names for an any-of filter', () => {
    render(
      <FilterBuilder
        {...base}
        cycles={[
          { id: 'c1', label: 'Cycle 1' },
          { id: 'c2', label: 'Cycle 2' },
        ]}
        filterSet={set({ field: 'cycle', operator: 'in', value: ['c1', 'c2'] })}
      />,
    );
    expect(screen.getByText('Cycle 1, Cycle 2')).toBeTruthy();
  });

  it('shows the estimate scale label (T-shirt size) for its stored number', () => {
    render(
      <FilterBuilder
        {...base}
        estimationType="tShirt"
        filterSet={set({ field: 'estimate', operator: 'eq', value: 3 })}
      />,
    );
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('renders overdue with no value', () => {
    render(<FilterBuilder {...base} filterSet={set({ field: 'dueDate', operator: 'overdue' })} />);
    expect(screen.getByText('issues.operatorOverdue')).toBeTruthy();
  });
});

describe('AddFilterForm due date', () => {
  it('offers before/after/overdue (not any-of) for the date field', () => {
    render(
      <FilterBuilder
        {...base}
        filterSet={set({ field: 'dueDate', operator: 'before', value: '2026-05-01' })}
      />,
    );
    fireEvent.click(screen.getByLabelText('issues.editFilter'));
    // The operator trigger is the 2nd select button; open it.
    fireEvent.click(screen.getByText('issues.operatorBefore'));
    expect(screen.getByText('issues.operatorAfter')).toBeTruthy();
    expect(screen.getByText('issues.operatorOverdue')).toBeTruthy();
    expect(screen.queryByText('issues.operatorIsAnyOf')).toBeNull();
    expect(document.querySelector('input[type="date"]')).not.toBeNull();
  });
});

describe('AddFilterForm field changes', () => {
  const openAddForm = (props: Record<string, unknown> = {}) => {
    const onChange = vi.fn();
    render(
      <FilterBuilder
        {...base}
        filterSet={{ composition: 'and', conditions: [] }}
        onChange={onChange}
        {...props}
      />,
    );
    fireEvent.click(screen.getByText('issues.filter'));
    return onChange;
  };
  const pickField = (current: string, next: string) => {
    fireEvent.click(screen.getByText(current));
    // The open panel's option renders after the trigger carrying the same label.
    fireEvent.click(screen.getAllByText(next).at(-1) as HTMLElement);
  };

  it('resets the operator to one valid for the new field', () => {
    openAddForm();
    expect(screen.getByText('issues.operatorIs')).toBeTruthy();

    pickField('issues.status', 'issues.dueDate');
    expect(screen.getByText('issues.operatorBefore')).toBeTruthy();
    expect(screen.queryByText('issues.operatorIs')).toBeNull();

    // Back to a non-date field: `before` is not valid there and must not linger.
    pickField('issues.dueDate', 'issues.priority');
    expect(screen.getByText('issues.operatorIs')).toBeTruthy();
    expect(screen.queryByText('issues.operatorBefore')).toBeNull();
  });

  it('stores an estimate as a number, not the picker string', () => {
    const onChange = openAddForm({ estimationType: 'fibonacci' });
    pickField('issues.status', 'issues.estimate');
    fireEvent.click(screen.getByText('issues.selectEllipsis'));
    fireEvent.click(screen.getAllByText('3').at(-1) as HTMLElement);
    fireEvent.click(screen.getByText('issues.add'));
    expect(onChange).toHaveBeenCalledWith({
      composition: 'and',
      conditions: [{ field: 'estimate', operator: 'eq', value: 3 }],
    });
  });

  it('does not offer Estimate when the issues in view mix estimation scales', () => {
    openAddForm({ estimateScaleMixed: true });
    fireEvent.click(screen.getByText('issues.status'));
    expect(screen.getAllByText('issues.dueDate').length).toBeGreaterThan(0);
    expect(screen.queryByText('issues.estimate')).toBeNull();
  });

  it('offers Estimate when the scale is shared', () => {
    openAddForm({ estimationType: 'fibonacci' });
    fireEvent.click(screen.getByText('issues.status'));
    expect(screen.getByText('issues.estimate')).toBeTruthy();
  });
});
