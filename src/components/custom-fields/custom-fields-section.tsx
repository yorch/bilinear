'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
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

function getTypeOptions(
  t: ReturnType<typeof useTranslations>,
): { value: CustomFieldType; label: string }[] {
  return [
    { label: t('customFields.fieldType.text'), value: 'text' },
    { label: t('customFields.fieldType.number'), value: 'number' },
    { label: t('customFields.fieldType.date'), value: 'date' },
    { label: t('customFields.fieldType.url'), value: 'url' },
    { label: t('customFields.fieldType.checkbox'), value: 'checkbox' },
    { label: t('customFields.fieldType.selectSingle'), value: 'select' },
    { label: t('customFields.fieldType.selectMultiple'), value: 'multi_select' },
  ];
}

const MAX_FIELDS = 20;

export const CustomFieldsSection = observer(({ teamId }: { teamId: string }) => {
  const t = useTranslations();
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
      toast.success(t('customFields.addSuccess'));
      setIsAdding(false);
    } catch (err) {
      toast.error(getErrorMessage(err, t('customFields.createFailed')));
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await gql(ARCHIVE_MUTATION, { id });
      toast.success(t('customFields.archiveSuccess'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('customFields.archiveFailed')));
    }
  };

  const atLimit = definitions.length >= MAX_FIELDS;

  return (
    <section>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('customFields.title')}
      </h2>
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-zinc-800">
          <p className="text-xs text-muted-foreground">
            {t('customFields.fieldCount', { count: definitions.length, max: MAX_FIELDS })}
          </p>
          {!isAdding && (
            <button
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              disabled={atLimit}
              onClick={() => setIsAdding(true)}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('customFields.addField')}
            </button>
          )}
        </div>

        {isAdding && (
          <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
            <CustomFieldForm onCancel={() => setIsAdding(false)} onSubmit={handleCreate} />
          </div>
        )}

        <ul className="divide-y divide-border">
          {definitions.length === 0 && !isAdding && (
            <li className="p-4 text-sm text-zinc-400">{t('customFields.emptyState')}</li>
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
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      {t('customFields.required')}
                    </span>
                  )}
                </div>
                {def.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{def.description}</p>
                )}
              </div>
              <button
                aria-label={t('customFields.archive')}
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
  const t = useTranslations();
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
            {t('customFields.name')}
          </label>
          <input
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            id="cf-name"
            onChange={e => setName(e.target.value)}
            placeholder={t('customFields.namePlaceholder')}
            value={name}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500" htmlFor="cf-type">
            {t('customFields.type')}
          </label>
          <SimpleSelect
            onChange={v => setType(v as CustomFieldType)}
            options={getTypeOptions(t)}
            value={type}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-500" htmlFor="cf-desc">
          {t('customFields.descriptionOptional')}
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
          <p className="text-xs font-medium text-zinc-500">{t('customFields.options')}</p>
          {options.map(opt => (
            <div className="flex items-center gap-2" key={opt.key}>
              <input
                className="w-24 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                onChange={e => updateOption(opt.key, { value: e.target.value })}
                placeholder={t('customFields.optionValue')}
                value={opt.value}
              />
              <input
                className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                onChange={e => updateOption(opt.key, { label: e.target.value })}
                placeholder={t('customFields.optionLabel')}
                value={opt.label}
              />
              <button
                aria-label={t('customFields.removeOption')}
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
            {t('customFields.addOption')}
          </button>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input checked={required} onChange={e => setRequired(e.target.checked)} type="checkbox" />
        {t('customFields.requiredOnCreate')}
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded px-3 py-1.5 text-xs text-zinc-500 hover:bg-accent"
          onClick={onCancel}
          type="button"
        >
          {t('common.cancel')}
        </button>
        <button
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitting ? t('customFields.adding') : t('customFields.addField')}
        </button>
      </div>
    </div>
  );
}
