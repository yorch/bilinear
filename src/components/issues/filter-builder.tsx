'use client';

import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCustomFieldDefinition, DBWorkflowState } from '@/lib/db';
import type {
  FilterComposition,
  FilterCondition,
  FilterField,
  FilterOperator,
  FilterSet,
} from '@/lib/filter-engine';
import { cn, TOUCH_TARGET } from '@/lib/utils';
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
  onEdit: () => void;
  onRemove: () => void;
  states: DBWorkflowState[];
  users: IssueUser[];
}

function FilterPill({
  condition,
  states,
  users,
  labels,
  customFields,
  onEdit,
  onRemove,
}: FilterPillProps) {
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

  const rawValues: unknown[] = Array.isArray(condition.value)
    ? condition.value
    : condition.value === undefined || condition.value === null
      ? []
      : [condition.value];
  const labelOf = (v: unknown): string => {
    switch (condition.field) {
      case 'status':
        return states.find(st => st.id === v)?.name ?? String(v);
      case 'assignee':
      case 'creator':
        return users.find(u => u.id === v)?.displayName ?? String(v);
      case 'label':
        return labels.find(l => l.id === v)?.name ?? String(v);
      case 'priority':
        return t(priorityLabelKey(Number(v)));
      case 'custom':
        if (customDef?.type === 'checkbox') {
          return v === true || v === 'true' ? t('issues.true') : t('issues.false');
        }
        return customDef?.options?.find(o => o.value === v)?.label ?? String(v ?? '');
      default:
        return String(v ?? '');
    }
  };
  const valueLabel =
    condition.operator === 'is_set' || condition.operator === 'is_not_set'
      ? ''
      : rawValues.map(labelOf).join(', ');

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground-secondary">
      <button
        aria-label={t('issues.editFilter')}
        className="inline-flex items-center gap-1 rounded-full hover:text-foreground"
        onClick={onEdit}
        title={t('issues.editFilter')}
        type="button"
      >
        <span className="font-medium">{fieldLabel}</span>
        <span className="text-muted-foreground">{opLabel}</span>
        {valueLabel && <span className="max-w-48 truncate">{valueLabel}</span>}
      </button>
      <button
        aria-label={t('issues.removeFilter')}
        className={cn('ml-0.5 text-muted-foreground hover:text-foreground-secondary', TOUCH_TARGET)}
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
  /** Pre-fills the form when editing an existing pill. */
  initial?: FilterCondition;
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

interface ValueOption {
  label: string;
  value: string;
}

/** Condition value -> the form's string[] working state. */
function valuesToStrings(value: FilterCondition['value']): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return value === undefined || value === null ? [] : [String(value)];
}

/**
 * Searchable checkbox list for the "is any of / is none of" operators. Stays
 * open while toggling so several values can be picked in one go.
 */
function MultiValuePicker({
  emptyText,
  onToggle,
  options,
  placeholder,
  searchPlaceholder,
  selected,
}: {
  emptyText: string;
  onToggle: (value: string) => void;
  options: ValueOption[];
  placeholder: string;
  searchPlaceholder: string;
  selected: string[];
}) {
  const t = useTranslations();
  const [search, setSearch] = useState('');
  const visible = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
        : t('issues.valuesSelected', { count: selected.length });

  return (
    <SelectPopover
      onClose={() => setSearch('')}
      triggerChildren={
        <>
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </>
      }
      triggerClassName="gap-1 border border-input px-2 py-1 text-xs"
    >
      {() => (
        <div className="w-56 p-1">
          <input
            aria-label={searchPlaceholder}
            className="mb-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
            data-autofocus
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            type="text"
            value={search}
          />
          {visible.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
          )}
          <div
            aria-label={searchPlaceholder}
            aria-multiselectable="true"
            className="max-h-48 overflow-y-auto"
            role="listbox"
          >
            {visible.map(o => {
              const isOn = selected.includes(o.value);
              return (
                <button
                  aria-selected={isOn}
                  className={cn(POPOVER_ITEM_CLASS, 'text-xs', isOn && 'bg-accent/50')}
                  key={o.value}
                  onClick={() => onToggle(o.value)}
                  role="option"
                  type="button"
                >
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                    {isOn && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate text-left">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </SelectPopover>
  );
}

function AddFilterForm({
  states,
  users,
  labels,
  customFields,
  initial,
  onAdd,
  onCancel,
}: AddFilterFormProps) {
  const t = useTranslations();
  const filterFields = useFilterFields();
  const operators = useOperators();
  const [fieldValue, setFieldValue] = useState<string>(
    initial
      ? initial.field === 'custom' && initial.customFieldId
        ? `custom:${initial.customFieldId}`
        : initial.field
      : 'status',
  );
  const [operator, setOperator] = useState<FilterOperator>(initial?.operator ?? 'eq');
  // Always a list: a single-value operator just uses the first entry. Keeping
  // one shape means switching "is" -> "is any of" never loses the pick.
  const [values, setValues] = useState<string[]>(valuesToStrings(initial?.value));

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

  const getValueOptions = (): ValueOption[] => {
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

  const valueOptions = getValueOptions();
  const needsValue = operator !== 'is_set' && operator !== 'is_not_set';
  const isMulti = operator === 'in' || operator === 'nin';
  const hasValue = values.some(v => v !== '');

  const resolveValue = (raw: string): string | number | boolean => {
    if (field === 'priority') {
      return Number.parseInt(raw, 10);
    }
    if (customDef?.type === 'number') {
      return Number(raw);
    }
    if (customDef?.type === 'checkbox') {
      return raw === 'true';
    }
    return raw;
  };

  const submit = () => {
    let value: FilterCondition['value'];
    if (needsValue) {
      const picked = values.filter(v => v !== '');
      // in / nin always carry an array so the engine and any stored view agree
      // on the shape; eq / neq carry one scalar.
      // (the engine compares by string, so the list stays as the picker's strings)
      value = isMulti ? picked : resolveValue(picked[0] ?? '');
    }
    onAdd({
      field,
      operator,
      ...(customFieldId ? { customFieldId } : {}),
      ...(needsValue ? { value } : {}),
    });
  };

  const valueTrigger = (summary: string) => (
    <>
      <span className="truncate">{summary}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-e2">
      <SelectPopover
        triggerChildren={valueTrigger(fieldOptions.find(f => f.value === fieldValue)?.label ?? '')}
        triggerClassName="gap-1 border border-input px-2 py-1 text-xs"
      >
        {close => (
          <div className="max-h-64 w-40 overflow-y-auto py-1">
            {fieldOptions.map(f => (
              <button
                className={cn(
                  POPOVER_ITEM_CLASS,
                  'text-xs',
                  f.value === fieldValue && 'bg-accent/50',
                )}
                key={f.value}
                onClick={() => {
                  setFieldValue(f.value);
                  setValues([]);
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
        triggerChildren={valueTrigger(operators.find(o => o.value === operator)?.label ?? '')}
        triggerClassName="gap-1 border border-input px-2 py-1 text-xs"
      >
        {close => (
          <div className="max-h-64 w-44 overflow-y-auto py-1">
            {operators.map(o => (
              <button
                className={cn(
                  POPOVER_ITEM_CLASS,
                  'text-xs',
                  o.value === operator && 'bg-accent/50',
                )}
                key={o.value}
                onClick={() => {
                  setOperator(o.value);
                  if (o.value !== 'in' && o.value !== 'nin') {
                    setValues(prev => prev.slice(0, 1));
                  }
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
        (valueOptions.length > 0 ? (
          isMulti ? (
            <MultiValuePicker
              emptyText={t('commandPalette.submenu.noOptions')}
              onToggle={v =>
                setValues(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]))
              }
              options={valueOptions}
              placeholder={t('issues.selectEllipsis')}
              searchPlaceholder={t('common.search')}
              selected={values}
            />
          ) : (
            <SearchableSelectPopover
              emptyText={t('commandPalette.submenu.noOptions')}
              getKey={opt => opt.value}
              isSelected={opt => opt.value === values[0]}
              items={valueOptions}
              matchesSearch={(opt, search) =>
                opt.label.toLowerCase().includes(search.toLowerCase())
              }
              onSelect={opt => setValues([opt.value])}
              renderItem={opt => <span className="truncate text-left">{opt.label}</span>}
              searchPlaceholder={t('common.search')}
              triggerChildren={valueTrigger(
                valueOptions.find(opt => opt.value === values[0])?.label ??
                  t('issues.selectEllipsis'),
              )}
              triggerClassName="gap-1 border border-input px-2 py-1 text-xs"
            />
          )
        ) : (
          <input
            aria-label={t('issues.valueEllipsis')}
            className="w-28 rounded border border-input px-2 py-1 text-xs dark:bg-muted text-foreground"
            onChange={e => setValues([e.target.value])}
            placeholder={t('issues.valueEllipsis')}
            type="text"
            value={values[0] ?? ''}
          />
        ))}

      <button
        className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={needsValue && !hasValue}
        onClick={submit}
        type="button"
      >
        {initial ? t('common.save') : t('issues.add')}
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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleRemove = (index: number) => {
    const conditions = filterSet.conditions.filter((_, i) => i !== index);
    onChange({ ...filterSet, conditions });
  };

  const handleAdd = (condition: FilterCondition) => {
    onChange({
      ...filterSet,
      conditions:
        editingIndex === null
          ? [...filterSet.conditions, condition]
          : filterSet.conditions.map((c, i) => (i === editingIndex ? condition : c)),
    });
    setShowAddForm(false);
    setEditingIndex(null);
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditingIndex(null);
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

  const formFor = (initial?: FilterCondition) => (
    <AddFilterForm
      customFields={customFields}
      initial={initial}
      key={editingIndex ?? 'new'}
      labels={labels}
      onAdd={handleAdd}
      onCancel={closeForm}
      states={states}
      users={users}
    />
  );

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      {filterSet.conditions.length > 1 && (
        <button
          className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-subtle-foreground transition-colors hover:bg-brand-subtle/80"
          onClick={toggleComposition}
          title={t('issues.filterMatchToggle')}
          type="button"
        >
          {filterSet.composition === 'and'
            ? t('issues.filterMatchAll')
            : t('issues.filterMatchAny')}
        </button>
      )}

      {filterSet.conditions.map((condition, index) =>
        editingIndex === index ? (
          <span key={`edit-${condition.field}-${condition.customFieldId ?? ''}`}>
            {formFor(condition)}
          </span>
        ) : (
          <FilterPill
            condition={condition}
            customFields={customFields}
            key={`${condition.field}-${condition.customFieldId ?? ''}-${condition.operator}-${String(condition.value)}`}
            labels={labels}
            onEdit={() => {
              setShowAddForm(false);
              setEditingIndex(index);
            }}
            onRemove={() => {
              closeForm();
              handleRemove(index);
            }}
            states={states}
            users={users}
          />
        ),
      )}

      {showAddForm && editingIndex === null ? (
        formFor()
      ) : editingIndex === null ? (
        <button
          aria-label={t('issues.addFilter')}
          className={cn(
            'flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground-secondary',
            TOUCH_TARGET,
          )}
          onClick={() => setShowAddForm(true)}
          title={t('issues.addFilter')}
          type="button"
        >
          <Plus className="h-3 w-3" />
        </button>
      ) : null}

      {filterSet.conditions.length > 0 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground-secondary"
          onClick={() => {
            closeForm();
            onChange({ composition: 'and', conditions: [] });
          }}
          type="button"
        >
          {t('issues.clearAll')}
        </button>
      )}
    </div>
  );
}
