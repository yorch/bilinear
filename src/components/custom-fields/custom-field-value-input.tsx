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
          value={typeof value === 'string' ? value : ''}
          onSave={v => onSave(v.length > 0 ? v : null)}
        />
      );
    case 'url':
      return (
        <TextInput
          type="url"
          value={typeof value === 'string' ? value : ''}
          onSave={v => onSave(v.length > 0 ? v : null)}
          placeholder="https://…"
        />
      );
    case 'number':
      return (
        <TextInput
          type="number"
          value={value == null ? '' : String(value)}
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
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onSave(e.target.value || null)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={e => onSave(e.target.checked)}
        />
      );
    case 'select':
      return (
        <SimpleSelect
          value={typeof value === 'string' ? value : ''}
          onChange={v => onSave(v || null)}
          options={[
            { label: '—', value: '' },
            ...options.map(o => ({ label: o.label, value: o.value })),
          ]}
        />
      );
    case 'multi_select':
      return (
        <MultiSelect
          values={Array.isArray(value) ? (value as string[]) : []}
          options={options}
          onSave={next => onSave(next.length > 0 ? next : null)}
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
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onSave(draft);
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
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
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={
              selected
                ? 'rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                : 'rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
