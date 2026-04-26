'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { DBCustomFieldDefinition, DBWorkflowState } from '@/lib/db';
import type {
  FilterComposition,
  FilterCondition,
  FilterField,
  FilterOperator,
  FilterSet,
} from '@/lib/filter-engine';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser } from '@/types/issues';

// ─── Field config ───────────────────────────────────────────────────────────

const FILTER_FIELDS: { label: string; value: FilterField }[] = [
  { label: 'Status', value: 'status' },
  { label: 'Assignee', value: 'assignee' },
  { label: 'Priority', value: 'priority' },
  { label: 'Label', value: 'label' },
  { label: 'Creator', value: 'creator' },
  { label: 'Project', value: 'project' },
  { label: 'Cycle', value: 'cycle' },
  { label: 'Estimate', value: 'estimate' },
  { label: 'Due date', value: 'dueDate' },
];

const OPERATORS: { label: string; value: FilterOperator }[] = [
  { label: 'is', value: 'eq' },
  { label: 'is not', value: 'neq' },
  { label: 'is any of', value: 'in' },
  { label: 'is none of', value: 'nin' },
  { label: 'is set', value: 'is_set' },
  { label: 'is not set', value: 'is_not_set' },
];

const PRIORITY_OPTIONS = [
  { label: 'No priority', value: '0' },
  { label: 'Urgent', value: '1' },
  { label: 'High', value: '2' },
  { label: 'Medium', value: '3' },
  { label: 'Low', value: '4' },
];

// ─── Filter Pill ────────────────────────────────────────────────────────────

interface FilterPillProps {
  condition: FilterCondition;
  customFields?: DBCustomFieldDefinition[];
  labels: IssueLabel[];
  onRemove: () => void;
  states: DBWorkflowState[];
  users: IssueUser[];
}

function FilterPill({ condition, states, users, labels, customFields, onRemove }: FilterPillProps) {
  const customDef =
    condition.field === 'custom' && condition.customFieldId
      ? customFields?.find(d => d.id === condition.customFieldId)
      : undefined;
  const fieldLabel =
    customDef?.name ??
    FILTER_FIELDS.find(f => f.value === condition.field)?.label ??
    condition.field;
  const opLabel = OPERATORS.find(o => o.value === condition.operator)?.label ?? condition.operator;

  let valueLabel = '';
  if (condition.operator === 'is_set' || condition.operator === 'is_not_set') {
    valueLabel = '';
  } else if (condition.field === 'status') {
    valueLabel = states.find(s => s.id === condition.value)?.name ?? String(condition.value);
  } else if (condition.field === 'assignee' || condition.field === 'creator') {
    valueLabel = users.find(u => u.id === condition.value)?.displayName ?? String(condition.value);
  } else if (condition.field === 'label') {
    if (Array.isArray(condition.value)) {
      valueLabel = condition.value.map(v => labels.find(l => l.id === v)?.name ?? v).join(', ');
    } else {
      valueLabel = labels.find(l => l.id === condition.value)?.name ?? String(condition.value);
    }
  } else if (condition.field === 'priority') {
    valueLabel =
      PRIORITY_OPTIONS.find(p => p.value === String(condition.value))?.label ??
      String(condition.value);
  } else if (condition.field === 'custom' && customDef) {
    if (Array.isArray(condition.value)) {
      valueLabel = condition.value
        .map(v => customDef.options?.find(o => o.value === v)?.label ?? String(v))
        .join(', ');
    } else if (customDef.type === 'checkbox') {
      valueLabel = condition.value ? 'true' : 'false';
    } else {
      valueLabel =
        customDef.options?.find(o => o.value === condition.value)?.label ??
        String(condition.value ?? '');
    }
  } else {
    valueLabel = String(condition.value ?? '');
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      <span className="font-medium">{fieldLabel}</span>
      <span className="text-zinc-400 dark:text-zinc-500">{opLabel}</span>
      {valueLabel && <span>{valueLabel}</span>}
      <button
        className="ml-0.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        onClick={onRemove}
        type="button"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Add Filter Popover ─────────────────────────────────────────────────────

interface AddFilterFormProps {
  customFields?: DBCustomFieldDefinition[];
  labels: IssueLabel[];
  onAdd: (condition: FilterCondition) => void;
  onCancel: () => void;
  states: DBWorkflowState[];
  users: IssueUser[];
}

/**
 * Field-select option. Built-in values are FilterField strings; custom-field
 * entries use `custom:<uuid>` to carry the definition id through the select.
 */
interface FieldOption {
  label: string;
  value: string;
}

function AddFilterForm({
  states,
  users,
  labels,
  customFields,
  onAdd,
  onCancel,
}: AddFilterFormProps) {
  const [fieldValue, setFieldValue] = useState<string>('status');
  const [operator, setOperator] = useState<FilterOperator>('eq');
  const [value, setValue] = useState<string>('');

  const customFieldId = fieldValue.startsWith('custom:')
    ? fieldValue.slice('custom:'.length)
    : undefined;
  const customDef = customFieldId ? customFields?.find(d => d.id === customFieldId) : undefined;
  const field: FilterField = customFieldId ? 'custom' : (fieldValue as FilterField);

  const fieldOptions: FieldOption[] = [
    ...FILTER_FIELDS.map(f => ({ label: f.label, value: f.value })),
    ...(customFields ?? []).map(d => ({
      label: d.name,
      value: `custom:${d.id}`,
    })),
  ];

  const getValueOptions = () => {
    if (customDef) {
      if (customDef.type === 'select' || customDef.type === 'multi_select') {
        return (customDef.options ?? []).map(o => ({
          label: o.label,
          value: o.value,
        }));
      }
      if (customDef.type === 'checkbox') {
        return [
          { label: 'True', value: 'true' },
          { label: 'False', value: 'false' },
        ];
      }
      return [];
    }
    switch (field) {
      case 'status':
        return states.filter(s => !s.archivedAt).map(s => ({ label: s.name, value: s.id }));
      case 'assignee':
      case 'creator':
        return users.map(u => ({ label: u.displayName, value: u.id }));
      case 'label':
        return labels.map(l => ({ label: l.name, value: l.id }));
      case 'priority':
        return PRIORITY_OPTIONS;
      default:
        return [];
    }
  };

  const needsValue = operator !== 'is_set' && operator !== 'is_not_set';

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <select
        className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        onChange={e => {
          setFieldValue(e.target.value);
          setValue('');
        }}
        value={fieldValue}
      >
        {fieldOptions.map(f => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        onChange={e => setOperator(e.target.value as FilterOperator)}
        value={operator}
      >
        {OPERATORS.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {needsValue &&
        (getValueOptions().length > 0 ? (
          <select
            className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            onChange={e => setValue(e.target.value)}
            value={value}
          >
            <option value="">Select...</option>
            {getValueOptions().map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="w-28 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            onChange={e => setValue(e.target.value)}
            placeholder="Value..."
            type="text"
            value={value}
          />
        ))}

      <button
        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        disabled={needsValue && !value}
        onClick={() => {
          let resolvedValue: string | number | boolean = value;
          if (field === 'priority') {
            resolvedValue = Number.parseInt(value, 10);
          } else if (customDef?.type === 'number') {
            resolvedValue = Number(value);
          } else if (customDef?.type === 'checkbox') {
            resolvedValue = value === 'true';
          }
          onAdd({
            field,
            operator,
            ...(customFieldId ? { customFieldId } : {}),
            ...(needsValue ? { value: resolvedValue } : {}),
          });
        }}
        type="button"
      >
        Add
      </button>
      <button
        className="px-1 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Main Filter Builder ────────────────────────────────────────────────────

interface FilterBuilderProps {
  customFields?: DBCustomFieldDefinition[];
  filterSet: FilterSet;
  labels: IssueLabel[];
  onChange: (filterSet: FilterSet) => void;
  states: DBWorkflowState[];
  users: IssueUser[];
}

export function FilterBuilder({
  filterSet,
  onChange,
  states,
  users,
  labels,
  customFields,
}: FilterBuilderProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  const handleRemove = (index: number) => {
    const conditions = filterSet.conditions.filter((_, i) => i !== index);
    onChange({ ...filterSet, conditions });
  };

  const handleAdd = (condition: FilterCondition) => {
    onChange({
      ...filterSet,
      conditions: [...filterSet.conditions, condition],
    });
    setShowAddForm(false);
  };

  const toggleComposition = () => {
    const composition: FilterComposition = filterSet.composition === 'and' ? 'or' : 'and';
    onChange({ ...filterSet, composition });
  };

  if (filterSet.conditions.length === 0 && !showAddForm) {
    return (
      <button
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        onClick={() => setShowAddForm(true)}
        type="button"
      >
        <Plus className="h-3 w-3" />
        Filter
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filterSet.conditions.length > 1 && (
        <button
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
            filterSet.composition === 'and'
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
          )}
          onClick={toggleComposition}
          type="button"
        >
          {filterSet.composition === 'and' ? 'AND' : 'OR'}
        </button>
      )}

      {filterSet.conditions.map((condition, index) => (
        <FilterPill
          condition={condition}
          customFields={customFields}
          key={`${condition.field}-${condition.customFieldId ?? ''}-${condition.operator}-${String(condition.value)}`}
          labels={labels}
          onRemove={() => handleRemove(index)}
          states={states}
          users={users}
        />
      ))}

      {showAddForm ? (
        <AddFilterForm
          customFields={customFields}
          labels={labels}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
          states={states}
          users={users}
        />
      ) : (
        <button
          className="flex items-center gap-0.5 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          onClick={() => setShowAddForm(true)}
          type="button"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}

      {filterSet.conditions.length > 0 && (
        <button
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          onClick={() => onChange({ composition: 'and', conditions: [] })}
          type="button"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
