'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { SimpleSelect } from '@/components/ui/select';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'multi_select' | 'url' | 'checkbox';

interface Option {
  color?: string;
  label: string;
  value: string;
}

/** Draft option with a stable synthetic key so React list reconciles edits
 *  correctly before the options are submitted and real ids exist. */
interface DraftOption extends Option {
  key: string;
}

const DEF_FIELDS = `
  id teamId name type description required options sortOrder
  createdAt updatedAt archivedAt
`;

const CREATE_MUTATION = `
  mutation CustomFieldDefinitionCreate($input: CustomFieldDefinitionCreateInput!) {
    customFieldDefinitionCreate(input: $input) {
      success
      lastSyncId
      customFieldDefinition { ${DEF_FIELDS} }
    }
  }
`;

const ARCHIVE_MUTATION = `
  mutation CustomFieldDefinitionArchive($id: ID!) {
    customFieldDefinitionArchive(id: $id) {
      success
      lastSyncId
      customFieldDefinition { ${DEF_FIELDS} }
    }
  }
`;

const TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' },
  { label: 'URL', value: 'url' },
  { label: 'Checkbox', value: 'checkbox' },
  { label: 'Select (single)', value: 'select' },
  { label: 'Select (multiple)', value: 'multi_select' },
];

const MAX_FIELDS = 20;

export const CustomFieldsSection = observer(({ teamId }: { teamId: string }) => {
  const { customFieldStore } = useStore();
  const definitions = customFieldStore.findDefinitionsByTeamId(teamId);
  const [isAdding, setIsAdding] = useState(false);

  const handleCreate = async (input: {
    name: string;
    type: CustomFieldType;
    description: string;
    required: boolean;
    options: Option[];
  }) => {
    try {
      await gql(CREATE_MUTATION, {
        input: {
          description: input.description || null,
          name: input.name,
          options: input.type === 'select' || input.type === 'multi_select' ? input.options : null,
          required: input.required,
          teamId,
          type: input.type,
        },
      });
      toast.success('Custom field added');
      setIsAdding(false);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create custom field'));
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await gql(ARCHIVE_MUTATION, { id });
      toast.success('Custom field archived');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to archive custom field'));
    }
  };

  const atLimit = definitions.length >= MAX_FIELDS;

  return (
    <section>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Custom fields
      </h2>
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {definitions.length} of {MAX_FIELDS} fields
          </p>
          {!isAdding && (
            <button
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              disabled={atLimit}
              onClick={() => setIsAdding(true)}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              Add field
            </button>
          )}
        </div>

        {isAdding && (
          <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
            <CustomFieldForm onCancel={() => setIsAdding(false)} onSubmit={handleCreate} />
          </div>
        )}

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {definitions.length === 0 && !isAdding && (
            <li className="p-4 text-sm text-zinc-400">
              No custom fields yet. Add one to capture extra metadata on issues.
            </li>
          )}
          {definitions.map(def => (
            <li className="flex items-center justify-between gap-3 p-4" key={def.id}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {def.name}
                  </span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {def.type.replace('_', ' ')}
                  </span>
                  {def.required && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">required</span>
                  )}
                </div>
                {def.description && (
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {def.description}
                  </p>
                )}
              </div>
              <button
                aria-label="Archive"
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                onClick={() => handleArchive(def.id)}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------
// New-field form
// ---------------------------------------------------------------------------

function CustomFieldForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    type: CustomFieldType;
    description: string;
    required: boolean;
    options: Option[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<DraftOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const needsOptions = type === 'select' || type === 'multi_select';

  const addOption = () =>
    setOptions(prev => [...prev, { key: crypto.randomUUID(), label: '', value: '' }]);

  const updateOption = (key: string, patch: Partial<Option>) =>
    setOptions(prev => prev.map(o => (o.key === key ? { ...o, ...patch } : o)));

  const removeOption = (key: string) => setOptions(prev => prev.filter(o => o.key !== key));

  const canSubmit =
    name.trim().length > 0 &&
    (!needsOptions || (options.length > 0 && options.every(o => o.value && o.label)));

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        description: description.trim(),
        name: name.trim(),
        options: needsOptions
          ? options.map(({ color, label, value }) => ({ color, label, value }))
          : [],
        required,
        type,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500" htmlFor="cf-name">
            Name
          </label>
          <input
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            id="cf-name"
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Severity"
            value={name}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500" htmlFor="cf-type">
            Type
          </label>
          <SimpleSelect
            onChange={v => setType(v as CustomFieldType)}
            options={TYPE_OPTIONS}
            value={type}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-500" htmlFor="cf-desc">
          Description (optional)
        </label>
        <input
          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          id="cf-desc"
          onChange={e => setDescription(e.target.value)}
          value={description}
        />
      </div>

      {needsOptions && (
        <div className="flex flex-col gap-2 rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/50">
          <p className="text-xs font-medium text-zinc-500">Options</p>
          {options.map(opt => (
            <div className="flex items-center gap-2" key={opt.key}>
              <input
                className="w-24 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                onChange={e => updateOption(opt.key, { value: e.target.value })}
                placeholder="Value"
                value={opt.value}
              />
              <input
                className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                onChange={e => updateOption(opt.key, { label: e.target.value })}
                placeholder="Label"
                value={opt.label}
              />
              <button
                aria-label="Remove option"
                className="rounded p-1 text-zinc-400 hover:text-red-600"
                onClick={() => removeOption(opt.key)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            className="self-start rounded border border-dashed border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            onClick={addOption}
            type="button"
          >
            + Add option
          </button>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <input checked={required} onChange={e => setRequired(e.target.checked)} type="checkbox" />
        Required on issue creation
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitting ? 'Adding…' : 'Add field'}
        </button>
      </div>
    </div>
  );
}
