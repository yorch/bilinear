'use client';

import { Edit2, Plus, Star, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, gqlError } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const TEMPLATE_FIELDS = `
  id teamId creatorId name description templateData isDefault createdAt updatedAt archivedAt
`;

const CREATE_MUTATION = `
  mutation IssueTemplateCreate($input: IssueTemplateCreateInput!) {
    issueTemplateCreate(input: $input) {
      success
      lastSyncId
      issueTemplate { ${TEMPLATE_FIELDS} }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation IssueTemplateUpdate($id: ID!, $input: IssueTemplateUpdateInput!) {
    issueTemplateUpdate(id: $id, input: $input) {
      success
      lastSyncId
      issueTemplate { ${TEMPLATE_FIELDS} }
    }
  }
`;

const DELETE_MUTATION = `
  mutation IssueTemplateDelete($id: ID!) {
    issueTemplateDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateFormData {
  description: string;
  isDefault: boolean;
  name: string;
  templateData: {
    assigneeId?: string;
    labelIds?: string[];
    priority?: number;
    stateId?: string;
  };
}

function getPriorityOptions(t: ReturnType<typeof useTranslations>) {
  return [
    { label: t('issueDetail.templates.priorities.none'), value: '' },
    { label: t('issueDetail.templates.priorities.urgent'), value: '1' },
    { label: t('issueDetail.templates.priorities.high'), value: '2' },
    { label: t('issueDetail.templates.priorities.medium'), value: '3' },
    { label: t('issueDetail.templates.priorities.low'), value: '4' },
  ];
}

const emptyForm = (): TemplateFormData => ({
  description: '',
  isDefault: false,
  name: '',
  templateData: {},
});

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

export const IssueTemplatesSection = observer(({ teamId }: { teamId: string }) => {
  const t = useTranslations();
  const PRIORITY_OPTIONS = getPriorityOptions(t);
  const { issueTemplateStore, workflowStateStore, labelStore, userStore } = useStore();

  const templates = issueTemplateStore.findByTeamId(teamId);
  const states = workflowStateStore.findByTeamId(teamId);
  const labels = labelStore.all;
  const users = userStore.all;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async (form: TemplateFormData) => {
    const result = await gql(CREATE_MUTATION, {
      input: {
        description: form.description.trim() || null,
        isDefault: form.isDefault,
        name: form.name.trim(),
        teamId,
        templateData: buildTemplateData(form),
      },
    });
    if (result.errors?.length) {
      throw new Error(gqlError(result, t('issueDetail.templates.failedToCreate')));
    }
    const raw = (result.data?.issueTemplateCreate as { issueTemplate?: Record<string, unknown> })
      ?.issueTemplate;
    if (raw) {
      issueTemplateStore.applySyncAction('I', raw.id as string, raw as never);
    }
    toast.success(t('issueDetail.templates.created'));
    setIsAdding(false);
  };

  const handleUpdate = async (id: string, form: TemplateFormData) => {
    const result = await gql(UPDATE_MUTATION, {
      id,
      input: {
        description: form.description.trim() || null,
        isDefault: form.isDefault,
        name: form.name.trim(),
        templateData: buildTemplateData(form),
      },
    });
    if (result.errors?.length) {
      throw new Error(gqlError(result, t('issueDetail.templates.failedToUpdate')));
    }
    const raw = (result.data?.issueTemplateUpdate as { issueTemplate?: Record<string, unknown> })
      ?.issueTemplate;
    if (raw) {
      issueTemplateStore.applySyncAction('U', id, raw as never);
    }
    toast.success(t('issueDetail.templates.updated'));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const result = await gql(DELETE_MUTATION, { id });
      if (result.errors?.length) {
        toast.error(gqlError(result, t('issueDetail.templates.failedToDelete')));
        return;
      }
      issueTemplateStore.applySyncAction('D', id, null);
      toast.success(t('issueDetail.templates.deleted'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('issueDetail.templates.sectionTitle')}
      </h2>
      <div className="rounded-lg border border-border bg-card">
        {/* Header row */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <p className="text-xs text-muted-foreground">
            {t('issueDetail.templates.count', { count: templates.length })}
          </p>
          {!isAdding && (
            <button
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => setIsAdding(true)}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('issueDetail.templates.addTemplate')}
            </button>
          )}
        </div>

        {/* Inline "Add" form */}
        {isAdding && (
          <div className="border-b border-border p-4">
            <TemplateForm
              labels={labels}
              onCancel={() => setIsAdding(false)}
              onSubmit={handleCreate}
              states={states}
              submitLabel={t('issueDetail.templates.createTemplate')}
              users={users}
            />
          </div>
        )}

        {/* Template list */}
        <ul className="divide-y divide-border">
          {templates.length === 0 && !isAdding && (
            <li className="p-4 text-sm text-muted-foreground">
              {t('issueDetail.templates.emptyState')}
            </li>
          )}
          {templates.map(tmpl => {
            const isEditing = editingId === tmpl.id;
            const isDeleting = deletingId === tmpl.id;
            const td = tmpl.templateData as Record<string, unknown>;
            const stateName = td.stateId
              ? (states.find(s => s.id === td.stateId)?.name ?? null)
              : null;
            const priority =
              td.priority !== undefined && td.priority !== null
                ? (PRIORITY_OPTIONS.find(p => p.value === String(td.priority))?.label ?? null)
                : null;
            const assigneeName = td.assigneeId
              ? (users.find(u => u.id === td.assigneeId)?.displayName ?? null)
              : null;
            const labelCount =
              Array.isArray(td.labelIds) && td.labelIds.length > 0 ? td.labelIds.length : null;

            return (
              <li key={tmpl.id}>
                {isEditing ? (
                  <div className="p-4">
                    <TemplateForm
                      initialData={{
                        description: tmpl.description ?? '',
                        isDefault: tmpl.isDefault,
                        name: tmpl.name,
                        templateData: {
                          assigneeId: (td.assigneeId as string | undefined) ?? undefined,
                          labelIds: (td.labelIds as string[] | undefined) ?? undefined,
                          priority: td.priority !== undefined ? Number(td.priority) : undefined,
                          stateId: (td.stateId as string | undefined) ?? undefined,
                        },
                      }}
                      labels={labels}
                      onCancel={() => setEditingId(null)}
                      onSubmit={form => handleUpdate(tmpl.id, form)}
                      states={states}
                      submitLabel={t('issueDetail.templates.saveChanges')}
                      users={users}
                    />
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {tmpl.name}
                        </span>
                        {tmpl.isDefault && (
                          <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                        )}
                      </div>
                      {tmpl.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {tmpl.description}
                        </p>
                      )}
                      {/* Defaults preview */}
                      {(stateName ?? priority ?? assigneeName ?? labelCount) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {stateName && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('issueDetail.templates.statePrefix', { state: stateName })}
                            </span>
                          )}
                          {priority && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('issueDetail.templates.priorityPrefix', { priority })}
                            </span>
                          )}
                          {assigneeName && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('issueDetail.templates.assigneePrefix', {
                                assignee: assigneeName,
                              })}
                            </span>
                          )}
                          {labelCount && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('issueDetail.templates.labelCount', { count: labelCount })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        aria-label={t('issueDetail.templates.editTemplate')}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-zinc-700 dark:hover:text-zinc-300"
                        onClick={() => setEditingId(tmpl.id)}
                        type="button"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={t('issueDetail.templates.deleteTemplate')}
                        className={cn(
                          'rounded p-1 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20',
                          isDeleting && 'cursor-not-allowed opacity-50',
                        )}
                        disabled={isDeleting}
                        onClick={() => handleDelete(tmpl.id)}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTemplateData(form: TemplateFormData): Record<string, unknown> {
  const td: Record<string, unknown> = {};
  if (form.templateData.stateId) {
    td.stateId = form.templateData.stateId;
  }
  if (form.templateData.priority !== undefined && form.templateData.priority > 0) {
    td.priority = form.templateData.priority;
  }
  if (form.templateData.assigneeId) {
    td.assigneeId = form.templateData.assigneeId;
  }
  if (form.templateData.labelIds?.length) {
    td.labelIds = form.templateData.labelIds;
  }
  return td;
}

// ---------------------------------------------------------------------------
// Template form
// ---------------------------------------------------------------------------

interface DBWorkflowStateLike {
  id: string;
  name: string;
}

interface DBLabelLike {
  archivedAt?: string | null;
  id: string;
  name: string;
}

interface DBUserLike {
  displayName: string;
  id: string;
}

function TemplateForm({
  initialData,
  labels,
  onCancel,
  onSubmit,
  states,
  submitLabel,
  users,
}: {
  initialData?: TemplateFormData;
  labels: DBLabelLike[];
  onCancel: () => void;
  onSubmit: (data: TemplateFormData) => Promise<void>;
  states: DBWorkflowStateLike[];
  submitLabel: string;
  users: DBUserLike[];
}) {
  const t = useTranslations();
  const PRIORITY_OPTIONS = getPriorityOptions(t);
  const init = initialData ?? emptyForm();
  const [name, setName] = useState(init.name);
  const [description, setDescription] = useState(init.description);
  const [isDefault, setIsDefault] = useState(init.isDefault);
  const [stateId, setStateId] = useState(init.templateData.stateId ?? '');
  const [priority, setPriority] = useState(
    init.templateData.priority !== undefined ? String(init.templateData.priority) : '',
  );
  const [assigneeId, setAssigneeId] = useState(init.templateData.assigneeId ?? '');
  const [labelIds, setLabelIds] = useState<string[]>(init.templateData.labelIds ?? []);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0;

  const toggleLabel = (id: string) => {
    setLabelIds(prev => (prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        description,
        isDefault,
        name,
        templateData: {
          assigneeId: assigneeId || undefined,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
          priority: priority ? Number(priority) : undefined,
          stateId: stateId || undefined,
        },
      });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('common.somethingWentWrong')));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

  const selectCls =
    'rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

  return (
    <div className="flex flex-col gap-4">
      {/* Name + Description */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="tmpl-name">
            {t('issueDetail.templates.form.name')} <span className="text-red-500">*</span>
          </label>
          <input
            className={inputCls}
            id="tmpl-name"
            onChange={e => setName(e.target.value)}
            placeholder={t('issueDetail.templates.form.namePlaceholder')}
            value={name}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="tmpl-desc">
            {t('issueDetail.templates.form.description')}
          </label>
          <textarea
            className={cn(inputCls, 'resize-none')}
            id="tmpl-desc"
            onChange={e => setDescription(e.target.value)}
            placeholder={t('issueDetail.templates.form.descriptionPlaceholder')}
            rows={1}
            value={description}
          />
        </div>
      </div>

      {/* Template defaults */}
      <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/50">
        <p className="mb-2.5 text-xs font-medium text-muted-foreground">
          {t('issueDetail.templates.form.templateDefaults')}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="tmpl-state">
              {t('issueDetail.templates.form.status')}
            </label>
            <select
              className={selectCls}
              id="tmpl-state"
              onChange={e => setStateId(e.target.value)}
              value={stateId}
            >
              <option value="">{t('issueDetail.templates.form.none')}</option>
              {states.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="tmpl-priority">
              {t('issueDetail.templates.form.priority')}
            </label>
            <select
              className={selectCls}
              id="tmpl-priority"
              onChange={e => setPriority(e.target.value)}
              value={priority}
            >
              {PRIORITY_OPTIONS.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="tmpl-assignee">
              {t('issueDetail.templates.form.assignee')}
            </label>
            <select
              className={selectCls}
              id="tmpl-assignee"
              onChange={e => setAssigneeId(e.target.value)}
              value={assigneeId}
            >
              <option value="">{t('issueDetail.templates.form.unassigned')}</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Labels multi-select */}
        {labels.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t('issueDetail.templates.form.labels')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {labels.map(l => {
                const selected = labelIds.includes(l.id);
                return (
                  <button
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs transition-colors',
                      selected
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'border-border bg-card text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800',
                    )}
                    key={l.id}
                    onClick={() => toggleLabel(l.id)}
                    type="button"
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Default template toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          checked={isDefault}
          className="accent-indigo-600"
          onChange={e => setIsDefault(e.target.checked)}
          type="checkbox"
        />
        {t('issueDetail.templates.form.setAsDefault')}
      </label>

      {/* Actions */}
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
