'use client';

import { useEffect, useState } from 'react';
import { SimpleSelect } from '@/components/ui/select';
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
  const options = definition.options ?? [];

  switch (definition.type) {
    case 'text':
      return (
        <TextInput
          onSave={v => onSave(v.length > 0 ? v : null)}
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'url':
      return (
        <TextInput
          onSave={v => onSave(v.length > 0 ? v : null)}
          placeholder="https://…"
          type="url"
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'number':
      return (
        <TextInput
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
          type="number"
          value={value == null ? '' : String(value)}
        />
      );
    case 'date':
      return (
        <input
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          onChange={e => onSave(e.target.value || null)}
          type="date"
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'checkbox':
      return (
        <input checked={value === true} onChange={e => onSave(e.target.checked)} type="checkbox" />
      );
    case 'select':
      return (
        <SimpleSelect
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
  value,
  onSave,
  placeholder,
  type = 'text',
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  type?: 'text' | 'url' | 'number';
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      onBlur={() => {
        if (draft !== value) {
          onSave(draft);
        }
      }}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      type={type}
      value={draft}
    />
  );
}

// ---------------------------------------------------------------------------
// Internal: multi_select as comma-chip list
// ---------------------------------------------------------------------------

function MultiSelect({
  values,
  options,
  onSave,
}: {
  values: string[];
  options: { value: string; label: string }[];
  onSave: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    const has = values.includes(v);
    onSave(has ? values.filter(x => x !== v) : [...values, v]);
  };

  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => {
        const selected = values.includes(o.value);
        return (
          <button
            className={
              selected
                ? 'rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                : 'rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
            }
            key={o.value}
            onClick={() => toggle(o.value)}
            type="button"
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
