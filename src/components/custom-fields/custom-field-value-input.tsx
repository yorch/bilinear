'use client';

import { useEffect, useState } from 'react';
import { SimpleSelect } from '@/components/ui/select';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { formatNumberValue } from '@/lib/custom-field-format';
import { useFieldFormat } from '@/lib/custom-field-format-store';
import type { DBCustomFieldDefinition } from '@/lib/db';

/**
 * Per-type value editor for a single custom field. Calls onSave with the
 * new raw value (or null to clear) — caller persists via GraphQL.
 */
export function CustomFieldValueInput({
  definition,
  value,
  onSave,
}: {
  definition: DBCustomFieldDefinition;
  value: unknown;
  onSave: (next: unknown) => void;
}) {
  const t = useTranslations();
  const options = definition.options ?? [];

  switch (definition.type) {
    case 'text':
      return (
        <TextInput
          label={definition.name}
          onSave={v => onSave(v.length > 0 ? v : null)}
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'url':
      return (
        <TextInput
          label={definition.name}
          onSave={v => onSave(v.length > 0 ? v : null)}
          placeholder={t('customFields.urlPlaceholder')}
          type="url"
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'number':
      return (
        <NumberValueInput
          definitionId={definition.id}
          label={definition.name}
          onSave={v => {
            if (v === '') {
              onSave(null);
              return;
            }
            const n = Number(v);
            if (!Number.isNaN(n)) {
              onSave(n);
            }
          }}
          value={value}
        />
      );
    case 'date':
      return (
        <input
          aria-label={definition.name}
          className="rounded-md border border-border bg-card px-2 py-1 text-xs"
          onChange={e => onSave(e.target.value || null)}
          type="date"
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'checkbox':
      return (
        <input
          aria-label={definition.name}
          checked={value === true}
          onChange={e => onSave(e.target.checked)}
          type="checkbox"
        />
      );
    case 'select':
      return (
        <SimpleSelect
          ariaLabel={definition.name}
          onChange={v => onSave(v || null)}
          options={[
            { label: '—', value: '' },
            ...options.map(o => ({ label: o.label, value: o.value })),
          ]}
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'multi_select':
      return (
        <MultiSelect
          label={definition.name}
          onSave={next => onSave(next.length > 0 ? next : null)}
          options={options}
          values={Array.isArray(value) ? (value as string[]) : []}
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: debounced text input (save on blur + Enter)
// ---------------------------------------------------------------------------

function TextInput({
  label,
  value,
  onSave,
  placeholder,
  type = 'text',
  display,
}: {
  /** Shown instead of `value` (as text) while the input is not focused. */
  display?: string;
  label: string;
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  type?: 'text' | 'url' | 'number';
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const showDisplay = display !== undefined && !focused;

  return (
    <input
      aria-label={label}
      className="rounded-md border border-border bg-card px-2 py-1 text-xs"
      onBlur={() => {
        setFocused(false);
        if (draft !== value) {
          onSave(draft);
        }
      }}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      type={showDisplay ? 'text' : type}
      value={showDisplay ? display : draft}
    />
  );
}

/**
 * Number field: the raw number while editing (type=number keeps the native
 * stepper and numeric parsing), the formatted display when at rest. The saved
 * value is always the raw number.
 */
function NumberValueInput({
  definitionId,
  label,
  onSave,
  value,
}: {
  definitionId: string;
  label: string;
  onSave: (next: string) => void;
  value: unknown;
}) {
  const format = useFieldFormat(definitionId);
  const { intlLocale } = useFormatters();
  const raw = typeof value === 'number' ? String(value) : '';
  const display =
    format.kind !== 'plain' && raw !== ''
      ? formatNumberValue(value as number, format, intlLocale)
      : undefined;
  return <TextInput display={display} label={label} onSave={onSave} type="number" value={raw} />;
}

// ---------------------------------------------------------------------------
// Internal: multi_select as comma-chip list
// ---------------------------------------------------------------------------

function MultiSelect({
  label,
  values,
  options,
  onSave,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onSave: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    const has = values.includes(v);
    onSave(has ? values.filter(x => x !== v) : [...values, v]);
  };

  return (
    <fieldset className="flex flex-wrap gap-1 border-0 m-0 p-0">
      <legend className="sr-only">{label}</legend>
      {options.map(o => {
        const selected = values.includes(o.value);
        return (
          <button
            aria-pressed={selected}
            className={
              selected
                ? 'rounded-full bg-brand-subtle px-2 py-0.5 text-xs text-brand-subtle-foreground'
                : 'rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent'
            }
            key={o.value}
            onClick={() => toggle(o.value)}
            type="button"
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}
