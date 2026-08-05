'use client';

import { Check, Pencil, Target, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SectionAddButton, SectionHeader } from '@/components/shared/section-header';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import type { DBProjectMilestone } from '@/lib/db';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const MILESTONE_FIELDS =
  'id name description targetDate projectId sortOrder archivedAt createdAt updatedAt';

interface ProjectMilestonesSectionProps {
  projectId: string;
}

interface MilestoneFormState {
  description: string;
  name: string;
  targetDate: string;
}

const EMPTY_FORM: MilestoneFormState = { description: '', name: '', targetDate: '' };

interface MilestoneFormProps {
  initialValues?: MilestoneFormState;
  onCancel: () => void;
  onSubmit: (values: MilestoneFormState) => Promise<void>;
  submitLabel: string;
}

function MilestoneForm({
  initialValues = EMPTY_FORM,
  onCancel,
  onSubmit,
  submitLabel,
}: MilestoneFormProps) {
  const t = useTranslations();
  const [values, setValues] = useState<MilestoneFormState>(initialValues);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="mt-2 rounded-lg border border-border p-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <input
          className={cn(
            'w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none',
            'placeholder:text-muted-foreground focus:border-brand focus:ring-1 focus:ring-brand',
            'border-border text-foreground placeholder:text-muted-foreground dark:focus:border-brand',
          )}
          onChange={e => setValues(v => ({ ...v, name: e.target.value }))}
          placeholder={t('projects.milestoneName')}
          ref={nameRef}
          required
          type="text"
          value={values.name}
        />
        <textarea
          className={cn(
            'w-full resize-none rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none',
            'placeholder:text-muted-foreground focus:border-brand focus:ring-1 focus:ring-brand',
            'border-border text-foreground placeholder:text-muted-foreground dark:focus:border-brand',
          )}
          onChange={e => setValues(v => ({ ...v, description: e.target.value }))}
          placeholder={t('projects.descriptionOptionalPlaceholder')}
          rows={2}
          value={values.description}
        />
        <input
          className={cn(
            'w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none',
            'focus:border-brand focus:ring-1 focus:ring-brand',
            'border-border text-foreground dark:focus:border-brand',
          )}
          onChange={e => setValues(v => ({ ...v, targetDate: e.target.value }))}
          type="date"
          value={values.targetDate}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
          {t('common.cancel')}
        </button>
        <button
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-white transition-colors',
            'bg-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
          )}
          disabled={saving || !values.name.trim()}
          type="submit"
        >
          <Check className="h-3.5 w-3.5" />
          {saving ? t('common.saving') : submitLabel}
        </button>
      </div>
    </form>
  );
}

interface MilestoneRowProps {
  milestone: DBProjectMilestone;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}

function MilestoneRow({ milestone, onDelete, onEdit }: MilestoneRowProps) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = async () => {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      await onDelete(milestone.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5">
      <Target className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{milestone.name}</span>
        {milestone.description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {milestone.description}
          </span>
        )}
      </div>
      {milestone.targetDate && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(milestone.targetDate, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          className={cn(
            'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
            TOUCH_TARGET,
          )}
          onClick={() => onEdit(milestone.id)}
          title={t('projects.editMilestone')}
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          className={cn(
            'rounded p-1 text-muted-foreground hover:bg-danger-subtle hover:text-danger-subtle-foreground',
            TOUCH_TARGET,
          )}
          disabled={deleting}
          onClick={() => setConfirmingDelete(true)}
          title={t('projects.deleteMilestone')}
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <ConfirmDialog
        message={t('projects.deleteMilestoneConfirm', { name: milestone.name })}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        open={confirmingDelete}
        title={t('projects.deleteMilestone')}
      />
    </div>
  );
}

export const ProjectMilestonesSection = observer(function ProjectMilestonesSection({
  projectId,
}: ProjectMilestonesSectionProps) {
  const t = useTranslations();
  const { projectStore } = useStore();
  const milestones = projectStore.getMilestones(projectId);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setCreating(true);
  };

  const openEdit = (id: string) => {
    setCreating(false);
    setEditingId(id);
  };

  const handleCreate = async (values: MilestoneFormState) => {
    try {
      const res = await gql(
        `mutation ($input: ProjectMilestoneCreateInput!) {
          projectMilestoneCreate(input: $input) {
            success
            projectMilestone { ${MILESTONE_FIELDS} }
          }
        }`,
        {
          input: {
            description: values.description || undefined,
            name: values.name.trim(),
            projectId,
            targetDate: values.targetDate || undefined,
          },
        },
      );
      if (res.errors?.length) {
        throw new Error(
          (res.errors[0] as { message: string }).message ?? t('common.somethingWentWrong'),
        );
      }
      const milestone = (
        res.data as { projectMilestoneCreate?: { projectMilestone?: DBProjectMilestone } }
      )?.projectMilestoneCreate?.projectMilestone;
      if (milestone) {
        projectStore.applyMilestoneSyncAction('I', milestone.id, milestone);
      }
      setCreating(false);
    } catch (err) {
      toast.error(getErrorMessage(err, t('projects.failedToCreateMilestone')));
    }
  };

  const handleUpdate = async (id: string, values: MilestoneFormState) => {
    try {
      const res = await gql(
        `mutation ($id: ID!, $input: ProjectMilestoneUpdateInput!) {
          projectMilestoneUpdate(id: $id, input: $input) {
            success
            projectMilestone { ${MILESTONE_FIELDS} }
          }
        }`,
        {
          id,
          input: {
            description: values.description || undefined,
            name: values.name.trim(),
            targetDate: values.targetDate || undefined,
          },
        },
      );
      if (res.errors?.length) {
        throw new Error(
          (res.errors[0] as { message: string }).message ?? t('common.somethingWentWrong'),
        );
      }
      const milestone = (
        res.data as { projectMilestoneUpdate?: { projectMilestone?: DBProjectMilestone } }
      )?.projectMilestoneUpdate?.projectMilestone;
      if (milestone) {
        projectStore.applyMilestoneSyncAction('U', milestone.id, milestone);
      }
      setEditingId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, t('projects.failedToUpdateMilestone')));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await gql(
        `mutation ($id: ID!) {
          projectMilestoneDelete(id: $id) { success }
        }`,
        { id },
      );
      if (res.errors?.length) {
        throw new Error(
          (res.errors[0] as { message: string }).message ?? t('common.somethingWentWrong'),
        );
      }
      projectStore.applyMilestoneSyncAction('D', id, null);
    } catch (err) {
      toast.error(getErrorMessage(err, t('projects.failedToDeleteMilestone')));
    }
  };

  return (
    <div className="mt-6">
      <SectionHeader
        action={
          !creating &&
          !editingId && <SectionAddButton label={t('projects.addMilestone')} onClick={openCreate} />
        }
        title={t('projects.milestonesCount', { count: milestones.length })}
      />

      {creating && (
        <MilestoneForm
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
          submitLabel={t('common.create')}
        />
      )}

      {milestones.length === 0 && !creating ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t('projects.noMilestonesYet')}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {milestones.map(milestone => {
            if (editingId === milestone.id) {
              return (
                <MilestoneForm
                  initialValues={{
                    description: milestone.description ?? '',
                    name: milestone.name,
                    targetDate: milestone.targetDate ?? '',
                  }}
                  key={milestone.id}
                  onCancel={() => setEditingId(null)}
                  onSubmit={values => handleUpdate(milestone.id, values)}
                  submitLabel={t('common.save')}
                />
              );
            }
            return (
              <MilestoneRow
                key={milestone.id}
                milestone={milestone}
                onDelete={handleDelete}
                onEdit={openEdit}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
