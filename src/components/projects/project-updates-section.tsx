'use client';

import { Pencil, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { CreateUpdateForm, EditUpdateForm } from '@/components/shared/update-forms';
import { Badge } from '@/components/ui/badge';
import { gql } from '@/lib/graphql';
import { PROJECT_HEALTH_CONFIG } from '@/lib/project-constants';
import { formatRelativeTime } from '@/lib/utils';
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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Updates ({updates.length})
        </h3>
        {!creating && !editingId && (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={openCreate}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            Add update
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
              { input: { body, health: health || null, projectId } },
            );
            if (res.errors?.length) {
              throw new Error('mutation failed');
            }
          }}
          showNone
        />
      )}

      {updates.length === 0 && !creating ? (
        <p className="py-6 text-center text-xs text-zinc-400">
          No updates yet. Add one to share project health and progress.
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
                      { id: update.id, input: { body, health: health || null } },
                    );
                    if (res.errors?.length) {
                      throw new Error('mutation failed');
                    }
                  }}
                  showNone
                />
              );
            }

            return (
              <div
                className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                key={update.id}
              >
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
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {author?.displayName ?? 'Unknown'}
                    </span>
                    {health && (
                      <Badge className={health.color} variant="solid">
                        {health.label}
                      </Badge>
                    )}
                    <span className="text-xs text-zinc-400">
                      {formatRelativeTime(update.createdAt)}
                      {update.editedAt && ' (edited)'}
                    </span>
                  </div>
                  {isOwner && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        onClick={() => openEdit(update.id)}
                        title="Edit"
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
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
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
