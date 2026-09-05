'use client';

import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SectionAddButton } from '@/components/shared/section-header';
import { ColorSwatchPicker, resolveCssVar } from '@/components/teams/color-swatch-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ColorDot } from '@/components/ui/color-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import type { DBWorkflowState } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import {
  nextPosition,
  swapAdjacent,
  WORKFLOW_STATE_TYPES,
  type WorkflowStateType,
} from './team-settings-helpers';

const STATE_FIELDS = `
  id teamId name color description type position createdAt updatedAt archivedAt
`;

const STATE_CREATE_MUTATION = `
  mutation WorkflowStateCreate($input: WorkflowStateCreateInput!) {
    workflowStateCreate(input: $input) {
      success lastSyncId
      workflowState { ${STATE_FIELDS} }
    }
  }
`;

const STATE_UPDATE_MUTATION = `
  mutation WorkflowStateUpdate($id: ID!, $input: WorkflowStateUpdateInput!) {
    workflowStateUpdate(id: $id, input: $input) {
      success lastSyncId
      workflowState { ${STATE_FIELDS} }
    }
  }
`;

const STATE_ARCHIVE_MUTATION = `
  mutation WorkflowStateArchive($id: ID!) {
    workflowStateArchive(id: $id) {
      success lastSyncId
      workflowState { ${STATE_FIELDS} }
    }
  }
`;

function defaultStateColor(): string {
  return resolveCssVar('--entity-swatch-9') ?? 'var(--entity-swatch-9)';
}

interface StateFormInput {
  color: string;
  name: string;
  type: WorkflowStateType;
}

interface TeamWorkflowSectionProps {
  /** The team's default issue state — cannot be archived while it is the default. */
  defaultStateId: string | null;
  teamId: string;
}

export const TeamWorkflowSection = observer(function TeamWorkflowSection({
  defaultStateId,
  teamId,
}: TeamWorkflowSectionProps) {
  const t = useTranslations();
  const { workflowStateStore } = useStore();
  // `findByTeamId` sorts by position and reads the observable pool directly, so
  // a reorder (same pool size) re-renders this observer.
  const states = workflowStateStore.findByTeamId(teamId);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DBWorkflowState | null>(null);
  const [moving, setMoving] = useState(false);

  const typeOptions = useMemo(
    () =>
      WORKFLOW_STATE_TYPES.map(type => ({
        label: t(`settings.team.workflowStates.types.${type}`),
        value: type,
      })),
    [t],
  );

  const applyState = (payload: unknown, key: string, action: 'I' | 'U' | 'A') => {
    const state = (payload as Record<string, { workflowState?: DBWorkflowState }>)[key]
      ?.workflowState;
    if (state) {
      workflowStateStore.applySyncAction(action, state.id, state);
    }
    return state;
  };

  const handleCreate = async (input: StateFormInput) => {
    const data = await gqlMutate(STATE_CREATE_MUTATION, {
      input: { ...input, position: nextPosition(states), teamId },
    });
    applyState(data, 'workflowStateCreate', 'I');
    toast.success(t('settings.team.workflowStates.created', { name: input.name }));
    setIsAdding(false);
  };

  const handleUpdate = async (id: string, input: StateFormInput) => {
    // `type` is immutable on the server (no field in WorkflowStateUpdateInput).
    const data = await gqlMutate(STATE_UPDATE_MUTATION, {
      id,
      input: { color: input.color, name: input.name },
    });
    applyState(data, 'workflowStateUpdate', 'U');
    toast.success(t('settings.team.workflowStates.updated'));
    setEditingId(null);
  };

  const handleArchive = async (state: DBWorkflowState) => {
    setConfirming(null);
    try {
      const data = await gqlMutate(STATE_ARCHIVE_MUTATION, { id: state.id });
      const archived = applyState(data, 'workflowStateArchive', 'A');
      if (!archived) {
        workflowStateStore.applySyncAction('A', state.id, {
          ...state,
          archivedAt: new Date().toISOString(),
        });
      }
      toast.success(t('settings.team.workflowStates.archived', { name: state.name }));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.team.workflowStates.archiveFailed')));
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const writes = swapAdjacent(states, index, direction);
    if (!writes || moving) {
      return;
    }
    setMoving(true);
    try {
      for (const write of writes) {
        const data = await gqlMutate(STATE_UPDATE_MUTATION, {
          id: write.id,
          input: { position: write.position },
        });
        applyState(data, 'workflowStateUpdate', 'U');
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.team.workflowStates.reorderFailed')));
    } finally {
      setMoving(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('settings.team.workflowStates.title')}
        </h2>
        {!isAdding && (
          <SectionAddButton
            label={t('settings.team.workflowStates.add')}
            onClick={() => {
              setEditingId(null);
              setIsAdding(true);
            }}
          />
        )}
      </div>
      <div className="rounded-lg border border-border bg-card">
        {isAdding && (
          <div className="border-b border-border p-4">
            <StateForm
              initial={{ color: defaultStateColor(), name: '', type: 'unstarted' }}
              onCancel={() => setIsAdding(false)}
              onSubmit={handleCreate}
              submitLabel={t('settings.team.workflowStates.add')}
              typeOptions={typeOptions}
            />
          </div>
        )}
        {states.length === 0 && !isAdding ? (
          <EmptyState
            action={
              <Button onClick={() => setIsAdding(true)} size="sm" type="button" variant="outline">
                {t('settings.team.workflowStates.add')}
              </Button>
            }
            className="py-8"
            description={t('settings.team.workflowStates.emptyDescription')}
            title={t('settings.team.workflowStates.emptyTitle')}
          />
        ) : (
          <ul className="divide-y divide-border">
            {states.map((state, index) => {
              const isDefault = state.id === defaultStateId;
              return (
                <li className="p-4" key={state.id}>
                  {editingId === state.id ? (
                    <StateForm
                      initial={{
                        color: state.color,
                        name: state.name,
                        type: state.type as WorkflowStateType,
                      }}
                      lockType
                      onCancel={() => setEditingId(null)}
                      onSubmit={input => handleUpdate(state.id, input)}
                      submitLabel={t('common.save')}
                      typeOptions={typeOptions}
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <ColorDot color={state.color} size="md" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {state.name}
                      </span>
                      <Badge tone="muted" variant="square">
                        {t(`settings.team.workflowStates.types.${state.type}`)}
                      </Badge>
                      {isDefault && (
                        <Badge tone="brand" variant="square">
                          {t('settings.team.workflowStates.default')}
                        </Badge>
                      )}
                      <button
                        aria-label={t('settings.team.workflowStates.moveUp', { name: state.name })}
                        className={cn(
                          'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary disabled:opacity-40',
                          TOUCH_TARGET,
                        )}
                        disabled={index === 0 || moving}
                        onClick={() => void handleMove(index, 'up')}
                        type="button"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={t('settings.team.workflowStates.moveDown', {
                          name: state.name,
                        })}
                        className={cn(
                          'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary disabled:opacity-40',
                          TOUCH_TARGET,
                        )}
                        disabled={index === states.length - 1 || moving}
                        onClick={() => void handleMove(index, 'down')}
                        type="button"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={t('settings.team.workflowStates.editAria', {
                          name: state.name,
                        })}
                        className={cn(
                          'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary',
                          TOUCH_TARGET,
                        )}
                        onClick={() => {
                          setIsAdding(false);
                          setEditingId(state.id);
                        }}
                        type="button"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={t('settings.team.workflowStates.archiveAria', {
                          name: state.name,
                        })}
                        className={cn(
                          'rounded p-1 text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger-subtle-foreground disabled:cursor-not-allowed disabled:opacity-40',
                          TOUCH_TARGET,
                        )}
                        disabled={isDefault}
                        onClick={() => setConfirming(state)}
                        title={
                          isDefault ? t('settings.team.workflowStates.cannotArchiveDefault') : ''
                        }
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        confirmLabel={t('customFields.archive')}
        message={t('settings.team.workflowStates.archiveConfirm', {
          name: confirming?.name ?? '',
        })}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) {
            void handleArchive(confirming);
          }
        }}
        open={confirming !== null}
        title={t('settings.team.workflowStates.archiveTitle')}
      />
    </section>
  );
});

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

function StateForm({
  initial,
  lockType = false,
  onCancel,
  onSubmit,
  submitLabel,
  typeOptions,
}: {
  initial: StateFormInput;
  lockType?: boolean;
  onCancel: () => void;
  onSubmit: (input: StateFormInput) => Promise<void>;
  submitLabel: string;
  typeOptions: { label: string; value: WorkflowStateType }[];
}) {
  const t = useTranslations();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [type, setType] = useState<WorkflowStateType>(initial.type);
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = name.trim().length > 0 && color.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ color, name: name.trim(), type });
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.team.workflowStates.saveFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-3">
          <ColorDot color={color} size="md" />
          <Input
            aria-label={t('settings.team.workflowStates.name')}
            autoFocus
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
              if (e.key === 'Escape') {
                onCancel();
              }
            }}
            placeholder={t('settings.team.workflowStates.namePlaceholder')}
            value={name}
          />
        </div>
        <SimpleSelect
          ariaLabel={t('settings.team.workflowStates.type')}
          disabled={lockType}
          onChange={v => setType(v as WorkflowStateType)}
          options={typeOptions}
          value={type}
        />
      </div>
      <ColorSwatchPicker
        aria-label={t('settings.team.workflowStates.color')}
        onChange={setColor}
        value={color}
      />
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          {t('common.cancel')}
        </Button>
        <Button disabled={!canSubmit || submitting} onClick={handleSubmit} size="sm" type="button">
          {submitting ? t('common.saving') : submitLabel}
        </Button>
      </div>
    </div>
  );
}
