'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate } from '@/lib/graphql';
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
  const [confirmingArchive, setConfirmingArchive] = useState<{ id: string; name: string } | null>(
    null,
  );

  const handleCreate = async (input: {
    name: string;
    type: CustomFieldType;
    description: string;
    required: boolean;
    options: Option[];
  }) => {
    try {
      // Must throw on rejection: `setIsAdding(false)` unmounts the form and
      // discards everything the user typed, so a BAD_USER_INPUT cap breach or a
      // FORBIDDEN owner/admin guard used to toast "Field added" and wipe it.
      await gqlMutate(CREATE_MUTATION, {
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
    setConfirmingArchive(null);
    try {
      await gqlMutate(ARCHIVE_MUTATION, { id });
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
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <p className="text-xs text-muted-foreground">
            {t('customFields.fieldCount', { count: definitions.length, max: MAX_FIELDS })}
          </p>
          {!isAdding && (
            <button
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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
          <div className="border-b border-border p-4">
            <CustomFieldForm onCancel={() => setIsAdding(false)} onSubmit={handleCreate} />
          </div>
        )}

        <ul className="divide-y divide-border">
          {definitions.length === 0 && !isAdding && (
            <li className="p-4 text-sm text-muted-foreground">{t('customFields.emptyState')}</li>
          )}
          {definitions.map(def => (
            <li className="flex items-center justify-between gap-3 p-4" key={def.id}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{def.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {def.type.replace('_', ' ')}
                  </span>
                  {def.required && (
                    <span className="text-xs text-warning-subtle-foreground">
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
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger-subtle-foreground max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                onClick={() => setConfirmingArchive({ id: def.id, name: def.name })}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDialog
        confirmLabel={t('customFields.archive')}
        message={t('customFields.archiveConfirm', { name: confirmingArchive?.name ?? '' })}
        onCancel={() => setConfirmingArchive(null)}
        onConfirm={() => {
          if (confirmingArchive) {
            void handleArchive(confirmingArchive.id);
          }
        }}
        open={confirmingArchive !== null}
        title={t('customFields.archive')}
      />
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
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cf-name">
            {t('customFields.name')}
          </label>
          <input
            className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
            id="cf-name"
            onChange={e => setName(e.target.value)}
            placeholder={t('customFields.namePlaceholder')}
            value={name}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cf-type">
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
        <label className="text-xs font-medium text-muted-foreground" htmlFor="cf-desc">
          {t('customFields.descriptionOptional')}
        </label>
        <input
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
          id="cf-desc"
          onChange={e => setDescription(e.target.value)}
          value={description}
        />
      </div>

      {needsOptions && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <p className="text-xs font-medium text-muted-foreground">{t('customFields.options')}</p>
          {options.map(opt => (
            <div className="flex items-center gap-2" key={opt.key}>
              <input
                className="w-24 rounded-md border border-border bg-card px-2 py-1 text-xs"
                onChange={e => updateOption(opt.key, { value: e.target.value })}
                placeholder={t('customFields.optionValue')}
                value={opt.value}
              />
              <input
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
                onChange={e => updateOption(opt.key, { label: e.target.value })}
                placeholder={t('customFields.optionLabel')}
                value={opt.label}
              />
              <button
                aria-label={t('customFields.removeOption')}
                className="rounded p-1 text-muted-foreground hover:text-danger-subtle-foreground max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                onClick={() => removeOption(opt.key)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            className="self-start rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
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
          className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={onCancel}
          type="button"
        >
          {t('common.cancel')}
        </button>
        <button
          className="rounded bg-invert px-3 py-1.5 text-xs font-medium text-invert-foreground hover:bg-invert/90 disabled:opacity-50"
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
