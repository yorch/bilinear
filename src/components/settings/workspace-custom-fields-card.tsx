'use client';

import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

type CustomFieldType = DBCustomFieldDefinition['type'];

/**
 * Same document as the team-scoped section; `teamId: null` is what makes the
 * definition workspace-wide (owner/admin only, enforced server-side).
 */
const WORKSPACE_CUSTOM_FIELD_CREATE_MUTATION = `
  mutation WorkspaceCustomFieldCreate($input: CustomFieldDefinitionCreateInput!) {
    customFieldDefinitionCreate(input: $input) {
      success
      lastSyncId
      customFieldDefinition { id teamId name type description required options sortOrder }
    }
  }
`;

/** Select types need options, which this card deliberately does not offer. */
const SIMPLE_TYPES: readonly { labelKey: string; value: CustomFieldType }[] = [
  { labelKey: 'customFields.fieldType.text', value: 'text' },
  { labelKey: 'customFields.fieldType.number', value: 'number' },
  { labelKey: 'customFields.fieldType.date', value: 'date' },
  { labelKey: 'customFields.fieldType.url', value: 'url' },
  { labelKey: 'customFields.fieldType.checkbox', value: 'checkbox' },
];

/**
 * Workspace-level custom field definitions: the ones every team sees.
 *
 * The team settings page has the full editor (`CustomFieldsSection`), but it
 * takes a team id and lists that team's fields *plus* the workspace ones, so
 * there was no surface at all for creating a workspace-scoped definition — the
 * server supported `teamId: null` and nothing sent it. This card is the thin
 * listing-and-create for that scope; option-bearing select fields and editing
 * stay with the team editor, which is being extended separately.
 */
export const WorkspaceCustomFieldsCard = observer(function WorkspaceCustomFieldsCard({
  canManage,
}: {
  canManage: boolean;
}) {
  const t = useTranslations();
  const { customFieldStore } = useStore();
  const definitions = customFieldStore.activeDefinitions.filter(d => d.teamId === null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setSaving(true);
    try {
      await gqlMutate(WORKSPACE_CUSTOM_FIELD_CREATE_MUTATION, {
        input: { name: trimmed, teamId: null, type },
      });
      toast.success(t('customFields.addSuccess'));
      setName('');
      setType('text');
      setAdding(false);
    } catch (err) {
      toast.error(getErrorMessage(err, t('customFields.createFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-xs text-muted-foreground">
          {t('settings.workspace.customFieldsDescription')}
        </p>
        {canManage && (
          <Button
            onClick={() => setAdding(a => !a)}
            size="sm"
            type="button"
            variant={adding ? 'outline' : 'default'}
          >
            {adding ? t('common.cancel') : t('customFields.addField')}
          </Button>
        )}
      </div>

      {adding && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3"
          onSubmit={e => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <Input
            aria-label={t('customFields.name')}
            className="min-w-0 flex-1"
            onChange={e => setName(e.target.value)}
            placeholder={t('customFields.namePlaceholder')}
            value={name}
          />
          <SimpleSelect
            ariaLabel={t('customFields.type')}
            className="w-40"
            onChange={v => setType(v as CustomFieldType)}
            options={SIMPLE_TYPES.map(o => ({ label: t(o.labelKey), value: o.value }))}
            value={type}
          />
          <Button disabled={saving || !name.trim()} size="sm" type="submit">
            {saving ? t('customFields.adding') : t('common.create')}
          </Button>
        </form>
      )}

      <div className="border-t border-border">
        {definitions.length === 0 ? (
          <EmptyState
            className="m-4"
            size="compact"
            title={t('settings.workspace.customFieldsEmpty')}
          />
        ) : (
          <ul className="divide-y divide-border">
            {definitions.map(def => (
              <li className="flex items-center gap-3 px-5 py-3" key={def.id}>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{def.name}</span>
                <Badge tone="muted" variant="square">
                  {def.type}
                </Badge>
                {def.required && <Badge tone="outline">{t('customFields.required')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
