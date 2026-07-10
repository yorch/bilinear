'use client';

import { ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
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

function useFilterFields(): { label: string; value: FilterField }[] {
  const t = useTranslations();
  return [
    { label: t('issues.status'), value: 'status' },
    { label: t('issues.assignee'), value: 'assignee' },
    { label: t('issues.priority'), value: 'priority' },
    { label: t('issues.label'), value: 'label' },
    { label: t('issues.creator'), value: 'creator' },
    { label: t('issues.project'), value: 'project' },
    { label: t('issues.cycle'), value: 'cycle' },
    { label: t('issues.estimate'), value: 'estimate' },
    { label: t('issues.dueDate'), value: 'dueDate' },
  ];
}

function useOperators(): { label: string; value: FilterOperator }[] {
  const t = useTranslations();
  return [
    { label: t('issues.operatorIs'), value: 'eq' },
    { label: t('issues.operatorIsNot'), value: 'neq' },
    { label: t('issues.operatorIsAnyOf'), value: 'in' },
    { label: t('issues.operatorIsNoneOf'), value: 'nin' },
    { label: t('issues.operatorIsSet'), value: 'is_set' },
    { label: t('issues.operatorIsNotSet'), value: 'is_not_set' },
  ];
}

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
  const t = useTranslations();
  const filterFields = useFilterFields();
  const operators = useOperators();
  const customDef =
    condition.field === 'custom' && condition.customFieldId
      ? customFields?.find(d => d.id === condition.customFieldId)
      : undefined;
  const fieldLabel =
    customDef?.name ??
    filterFields.find(f => f.value === condition.field)?.label ??
    condition.field;
  const opLabel = operators.find(o => o.value === condition.operator)?.label ?? condition.operator;

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
    const p = Number(condition.value);
    valueLabel = t(priorityLabelKey(p));
  } else if (condition.field === 'custom' && customDef) {
    if (Array.isArray(condition.value)) {
      valueLabel = condition.value
        .map(v => customDef.options?.find(o => o.value === v)?.label ?? String(v))
        .join(', ');
    } else if (customDef.type === 'checkbox') {
      valueLabel = condition.value ? t('issues.true') : t('issues.false');
    } else {
      valueLabel =
        customDef.options?.find(o => o.value === condition.value)?.label ??
        String(condition.value ?? '');
    }
  } else {
    valueLabel = String(condition.value ?? '');
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground-secondary">
      <span className="font-medium">{fieldLabel}</span>
      <span className="text-muted-foreground">{opLabel}</span>
      {valueLabel && <span>{valueLabel}</span>}
      <button
        aria-label={t('issues.removeFilter')}
        className="ml-0.5 text-muted-foreground hover:text-foreground-secondary max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
        onClick={onRemove}
        title={t('issues.removeFilter')}
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
  const t = useTranslations();
  const filterFields = useFilterFields();
  const operators = useOperators();
  const [fieldValue, setFieldValue] = useState<string>('status');
  const [operator, setOperator] = useState<FilterOperator>('eq');
  const [value, setValue] = useState<string>('');

  const customFieldId = fieldValue.startsWith('custom:')
    ? fieldValue.slice('custom:'.length)
    : undefined;
  const customDef = customFieldId ? customFields?.find(d => d.id === customFieldId) : undefined;
  const field: FilterField = customFieldId ? 'custom' : (fieldValue as FilterField);

  const fieldOptions: FieldOption[] = [
    ...filterFields.map(f => ({ label: f.label, value: f.value })),
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
          { label: t('issues.true'), value: 'true' },
          { label: t('issues.false'), value: 'false' },
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
        return [0, 1, 2, 3, 4].map(p => ({
          label: t(priorityLabelKey(p)),
          value: String(p),
        }));
      default:
        return [];
    }
  };

  const needsValue = operator !== 'is_set' && operator !== 'is_not_set';

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
      <SelectPopover
        triggerChildren={
          <>
            <span className="truncate">
              {fieldOptions.find(f => f.value === fieldValue)?.label}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </>
        }
        triggerClassName="gap-1 border border-border px-2 py-1 text-xs"
      >
        {close => (
          <div className="max-h-64 w-40 overflow-y-auto py-1">
            {fieldOptions.map(f => (
              <button
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-accent',
                  f.value === fieldValue && 'bg-accent/50',
                )}
                key={f.value}
                onClick={() => {
                  setFieldValue(f.value);
                  setValue('');
                  close();
                }}
                type="button"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </SelectPopover>

      <SelectPopover
        triggerChildren={
          <>
            <span className="truncate">{operators.find(o => o.value === operator)?.label}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </>
        }
        triggerClassName="gap-1 border border-border px-2 py-1 text-xs"
      >
        {close => (
          <div className="max-h-64 w-44 overflow-y-auto py-1">
            {operators.map(o => (
              <button
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-accent',
                  o.value === operator && 'bg-accent/50',
                )}
                key={o.value}
                onClick={() => {
                  setOperator(o.value);
                  close();
                }}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </SelectPopover>

      {needsValue &&
        (getValueOptions().length > 0 ? (
          <SearchableSelectPopover
            emptyText={t('commandPalette.submenu.noOptions')}
            getKey={opt => opt.value}
            isSelected={opt => opt.value === value}
            items={getValueOptions()}
            matchesSearch={(opt, search) => opt.label.toLowerCase().includes(search.toLowerCase())}
            onSelect={opt => setValue(opt.value)}
            renderItem={opt => <span className="truncate text-left">{opt.label}</span>}
            searchPlaceholder={t('common.search')}
            triggerChildren={
              <>
                <span className="truncate">
                  {getValueOptions().find(opt => opt.value === value)?.label ??
                    t('issues.selectEllipsis')}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </>
            }
            triggerClassName="gap-1 border border-border px-2 py-1 text-xs"
          />
        ) : (
          <input
            className="w-28 rounded border border-border px-2 py-1 text-xs dark:bg-muted text-muted-foreground"
            onChange={e => setValue(e.target.value)}
            placeholder={t('issues.valueEllipsis')}
            type="text"
            value={value}
          />
        ))}

      <button
        className="rounded bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
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
        {t('issues.add')}
      </button>
      <button
        className="px-1 text-xs text-muted-foreground hover:text-foreground-secondary"
        onClick={onCancel}
        type="button"
      >
        {t('common.cancel')}
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
  const t = useTranslations();
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
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => setShowAddForm(true)}
        type="button"
      >
        <Plus className="h-3 w-3" />
        {t('issues.filter')}
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
              ? 'bg-brand-subtle text-brand-subtle-foreground dark:bg-brand-subtle dark:text-brand-subtle-foreground'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
          )}
          onClick={toggleComposition}
          type="button"
        >
          {filterSet.composition === 'and' ? t('issues.and') : t('issues.or')}
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
          className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground-secondary max-md:h-11 max-md:min-w-11 max-md:justify-center"
          onClick={() => setShowAddForm(true)}
          type="button"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}

      {filterSet.conditions.length > 0 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground-secondary"
          onClick={() => onChange({ composition: 'and', conditions: [] })}
          type="button"
        >
          {t('issues.clearAll')}
        </button>
      )}
    </div>
  );
}
