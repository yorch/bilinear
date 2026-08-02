'use client';

import { Pencil, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { CreateUpdateForm, EditUpdateForm } from '@/components/shared/update-forms';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { PROJECT_HEALTH_CONFIG, PROJECT_HEALTH_LABEL_KEYS } from '@/lib/project-constants';
import { useStore } from '@/providers/store-provider';
import { UserAvatar } from '../ui/user-avatar';

interface ProjectUpdatesSectionProps {
  projectId: string;
  viewerId: string;
}

export const ProjectUpdatesSection = observer(function ProjectUpdatesSection({
  projectId,
  viewerId,
}: ProjectUpdatesSectionProps) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const { projectStore, userStore } = useStore();
  const updates = projectStore.getUpdates(projectId);

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

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('projects.updatesCount', { count: updates.length })}
        </h3>
        {!creating && !editingId && (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
            onClick={openCreate}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('projects.addUpdate')}
          </button>
        )}
      </div>

      {creating && (
        <CreateUpdateForm
          onClose={() => setCreating(false)}
          onSubmit={async (body, health) => {
            const res = await gql(
              `mutation ($input: ProjectUpdateCreateInput!) {
                projectUpdateCreate(input: $input) { success }
              }`,
              // `bodyData` is `JSON!` and `health` is `String!` — the form's
              // "None" health is the empty string, not null. Both columns are
              // NOT NULL, so null fails at coercion on create and at the DB on
              // edit; '' is falsy everywhere health is rendered, so it reads as
              // "no health reported" exactly as None intends.
              { input: { body, bodyData: {}, health, projectId } },
            );
            if (res.errors?.length) {
              throw new Error(t('common.somethingWentWrong'));
            }
          }}
          showNone
        />
      )}

      {updates.length === 0 && !creating ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t('projects.noUpdatesYet')}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {updates.map(update => {
            const author = userStore.findById(update.userId);
            const isOwner = update.userId === viewerId;
            const health = update.health ? PROJECT_HEALTH_CONFIG[update.health] : null;

            if (editingId === update.id) {
              return (
                <EditUpdateForm
                  initialBody={update.body}
                  initialHealth={update.health ?? ''}
                  key={update.id}
                  onClose={() => setEditingId(null)}
                  onSave={async (body, health) => {
                    const res = await gql(
                      `mutation ($id: ID!, $input: ProjectUpdateUpdateInput!) {
                        projectUpdateUpdate(id: $id, input: $input) { success }
                      }`,
                      { id: update.id, input: { body, health } },
                    );
                    if (res.errors?.length) {
                      throw new Error(t('common.somethingWentWrong'));
                    }
                  }}
                  showNone
                />
              );
            }

            return (
              <div className="rounded-lg border border-border p-4" key={update.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {author && (
                      <UserAvatar
                        size="md"
                        user={{
                          avatarBackgroundColor: author.avatarBgColor,
                          avatarUrl: author.avatarUrl,
                          displayName: author.displayName,
                          initials: author.initials,
                        }}
                      />
                    )}
                    <span className="text-xs font-medium text-foreground-secondary">
                      {author?.displayName ?? t('projects.unknownAuthor')}
                    </span>
                    {health && (
                      <Badge tone={health.tone}>
                        {t(PROJECT_HEALTH_LABEL_KEYS[update.health ?? ''])}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(update.createdAt)}
                      {update.editedAt && ` (${t('projects.edited')})`}
                    </span>
                  </div>
                  {isOwner && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                        onClick={() => openEdit(update.id)}
                        title={t('common.edit')}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <DeleteUpdateButton
                        mutation={`mutation ($id: ID!) { projectUpdateDelete(id: $id) { success } }`}
                        updateId={update.id}
                      />
                    </div>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-secondary">
                  {update.body}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
