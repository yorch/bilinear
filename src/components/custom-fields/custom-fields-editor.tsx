'use client';

import { observer } from 'mobx-react-lite';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import { CustomFieldValueInput } from './custom-field-value-input';

const VALUES_SET_MUTATION = `
  mutation CustomFieldValuesSet($issueId: ID!, $values: [CustomFieldValueInput!]!) {
    customFieldValuesSet(issueId: $issueId, values: $values) {
      success
      lastSyncId
      values {
        id issueId definitionId value createdAt updatedAt
      }
    }
  }
`;

export const CustomFieldsEditor = observer(
  ({ issueId, teamId }: { issueId: string; teamId: string }) => {
    const { customFieldStore } = useStore();
    const definitions = customFieldStore.findDefinitionsByTeamId(teamId);

    if (definitions.length === 0) {
      return null;
    }

    const handleSave = async (definitionId: string, value: unknown) => {
      try {
        await gql(VALUES_SET_MUTATION, {
          issueId,
          values: [{ definitionId, value }],
        });
      } catch (err) {
        toast.error(getErrorMessage(err, 'Failed to save custom field'));
      }
    };

    return (
      <div className="mt-6">
        <p className="mb-2 text-xs font-medium text-zinc-500">Custom fields</p>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {definitions.map(def => {
            const current = customFieldStore.findValue(issueId, def.id);
            return (
              <ValueRow
                currentValue={current?.value}
                definitionId={def.id}
                issueId={issueId}
                key={def.id}
                label={def.name}
                onSave={v => handleSave(def.id, v)}
                required={def.required}
                type={def.type}
              />
            );
          })}
        </div>
      </div>
    );
  },
);

const ValueRow = observer(
  ({
    label,
    required,
    definitionId,
    issueId,
    type,
    currentValue,
    onSave,
  }: {
    label: string;
    required: boolean;
    definitionId: string;
    issueId: string;
    type: string;
    currentValue: unknown;
    onSave: (value: unknown) => void;
  }) => {
    const { customFieldStore } = useStore();
    const def = customFieldStore.findDefinitionById(definitionId);
    if (!def) {
      return null;
    }
    // Unused locals kept so caller API stays obvious; referenced via def below.
    void issueId;
    void type;
    return (
      <>
        <span className="text-zinc-500">
          {label}
          {required && <span className="ml-0.5 text-amber-500">*</span>}
        </span>
        <div className="flex items-center">
          <CustomFieldValueInput definition={def} onSave={onSave} value={currentValue} />
        </div>
      </>
    );
  },
);
