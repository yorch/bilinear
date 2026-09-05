'use client';

import { Pencil, Trash2 } from 'lucide-react';
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
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssueLabel } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const LABEL_FIELDS = `
  id name color description isGroup organizationId teamId parentId
  createdAt updatedAt archivedAt
`;

const LABEL_CREATE_MUTATION = `
  mutation IssueLabelCreate($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success lastSyncId
      issueLabel { ${LABEL_FIELDS} }
    }
  }
`;

const LABEL_UPDATE_MUTATION = `
  mutation IssueLabelUpdate($id: ID!, $input: IssueLabelUpdateInput!) {
    issueLabelUpdate(id: $id, input: $input) {
      success lastSyncId
      issueLabel { ${LABEL_FIELDS} }
    }
  }
`;

const LABEL_ARCHIVE_MUTATION = `
  mutation IssueLabelArchive($id: ID!) {
    issueLabelArchive(id: $id) {
      success lastSyncId
      issueLabel { ${LABEL_FIELDS} }
    }
  }
`;

/** Default colour for a new label: the first palette swatch, resolved to hex. */
function defaultLabelColor(): string {
  return resolveCssVar('--entity-swatch-1') ?? 'var(--entity-swatch-1)';
}

/**
 * Labels are organization-scoped rows with an optional `teamId`. A team's
 * settings page manages the labels that apply to its issues: its own plus the
 * workspace-wide ones (`teamId === null`), which the label picker also offers.
 */
export function labelsForTeam(labels: readonly DBIssueLabel[], teamId: string): DBIssueLabel[] {
  return labels
    .filter(l => !l.archivedAt && (l.teamId === teamId || l.teamId == null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const TeamLabelsSection = observer(function TeamLabelsSection({
  teamId,
}: {
  teamId: string;
}) {
  const t = useTranslations();
  const { labelStore } = useStore();
  const labels = useMemo(() => labelsForTeam(labelStore.all, teamId), [labelStore.all, teamId]);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DBIssueLabel | null>(null);

  const handleCreate = async (input: { color: string; name: string }) => {
    const data = await gqlMutate(LABEL_CREATE_MUTATION, { input: { ...input, teamId } });
    const created = (data.issueLabelCreate as { issueLabel?: DBIssueLabel }).issueLabel;
    if (created) {
      labelStore.applySyncAction('I', created.id, created);
    }
    toast.success(t('settings.team.labels.created', { name: input.name }));
    setIsAdding(false);
  };

  const handleUpdate = async (id: string, input: { color: string; name: string }) => {
    const data = await gqlMutate(LABEL_UPDATE_MUTATION, { id, input });
    const updated = (data.issueLabelUpdate as { issueLabel?: DBIssueLabel }).issueLabel;
    if (updated) {
      labelStore.applySyncAction('U', updated.id, updated);
    }
    toast.success(t('settings.team.labels.updated'));
    setEditingId(null);
  };

  const handleArchive = async (label: DBIssueLabel) => {
    setConfirming(null);
    try {
      const data = await gqlMutate(LABEL_ARCHIVE_MUTATION, { id: label.id });
      const archived = (data.issueLabelArchive as { issueLabel?: DBIssueLabel }).issueLabel;
      labelStore.applySyncAction(
        'A',
        label.id,
        archived ?? { ...label, archivedAt: new Date().toISOString() },
      );
      toast.success(t('settings.team.labels.archived', { name: label.name }));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.team.labels.archiveFailed')));
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('settings.team.labels.title')}
        </h2>
        {!isAdding && (
          <SectionAddButton
            label={t('settings.team.labels.add')}
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
            <LabelForm
              initial={{ color: defaultLabelColor(), name: '' }}
              onCancel={() => setIsAdding(false)}
              onSubmit={handleCreate}
              submitLabel={t('settings.team.labels.add')}
            />
          </div>
        )}
        {labels.length === 0 && !isAdding ? (
          <EmptyState
            action={
              <Button onClick={() => setIsAdding(true)} size="sm" type="button" variant="outline">
                {t('settings.team.labels.add')}
              </Button>
            }
            className="py-8"
            description={t('settings.team.labels.emptyDescription')}
            title={t('settings.team.labels.emptyTitle')}
          />
        ) : (
          <ul className="divide-y divide-border">
            {labels.map(label => (
              <li className="p-4" key={label.id}>
                {editingId === label.id ? (
                  <LabelForm
                    initial={{ color: label.color, name: label.name }}
                    onCancel={() => setEditingId(null)}
                    onSubmit={input => handleUpdate(label.id, input)}
                    submitLabel={t('common.save')}
                  />
                ) : (
                  <div className="flex items-center gap-3">
                    <ColorDot color={label.color} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {label.name}
                    </span>
                    {label.teamId == null && (
                      <Badge tone="muted" variant="square">
                        {t('settings.team.labels.workspaceScope')}
                      </Badge>
                    )}
                    {label.isGroup && (
                      <Badge tone="outline" variant="square">
                        {t('settings.team.labels.group')}
                      </Badge>
                    )}
                    <button
                      aria-label={t('settings.team.labels.editAria', { name: label.name })}
                      className={cn(
                        'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary',
                        TOUCH_TARGET,
                      )}
                      onClick={() => {
                        setIsAdding(false);
                        setEditingId(label.id);
                      }}
                      type="button"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={t('settings.team.labels.archiveAria', { name: label.name })}
                      className={cn(
                        'rounded p-1 text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger-subtle-foreground',
                        TOUCH_TARGET,
                      )}
                      onClick={() => setConfirming(label)}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        confirmLabel={t('customFields.archive')}
        message={t('settings.team.labels.archiveConfirm', { name: confirming?.name ?? '' })}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) {
            void handleArchive(confirming);
          }
        }}
        open={confirming !== null}
        title={t('settings.team.labels.archiveTitle')}
      />
    </section>
  );
});

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

function LabelForm({
  initial,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  initial: { color: string; name: string };
  onCancel: () => void;
  onSubmit: (input: { color: string; name: string }) => Promise<void>;
  submitLabel: string;
}) {
  const t = useTranslations();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = name.trim().length > 0 && color.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ color, name: name.trim() });
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.team.labels.saveFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ColorDot color={color} size="sm" />
        <Input
          aria-label={t('settings.team.labels.name')}
          autoFocus
          className="flex-1"
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
          placeholder={t('settings.team.labels.namePlaceholder')}
          value={name}
        />
      </div>
      <ColorSwatchPicker
        aria-label={t('settings.team.labels.color')}
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
