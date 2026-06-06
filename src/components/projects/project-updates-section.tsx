'use client';

import { MessageSquare, Pencil, Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { UpdateFormFields } from '@/components/shared/update-form-fields';
import { Badge } from '@/components/ui/badge';
import { gql } from '@/lib/graphql';
import { PROJECT_HEALTH_CONFIG } from '@/lib/project-constants';
import { toast } from '@/lib/toast';
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

      {creating && <CreateUpdateForm onClose={() => setCreating(false)} projectId={projectId} />}

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
                  updateId={update.id}
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

// ─── Create form ─────────────────────────────────────────────────────────────

interface CreateUpdateFormProps {
  onClose: () => void;
  projectId: string;
}

function CreateUpdateForm({ projectId, onClose }: CreateUpdateFormProps) {
  const [body, setBody] = useState('');
  const [health, setHealth] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await gql(
        `mutation ($input: ProjectUpdateCreateInput!) {
          projectUpdateCreate(input: $input) { success }
        }`,
        { input: { body: body.trim(), health: health || null, projectId } },
      );
      onClose();
    } catch {
      toast.error('Failed to post update');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center gap-2 pb-2">
        <MessageSquare className="h-4 w-4 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">New update</span>
        <button
          className="ml-auto rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          onClick={onClose}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <UpdateFormFields
        body={body}
        health={health}
        onBodyChange={setBody}
        onHealthChange={setHealth}
        placeholder="Describe the current status, blockers, or progress..."
        showNone
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          className="rounded px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={!body.trim() || submitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitting ? 'Posting...' : 'Post update'}
        </button>
      </div>
    </div>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────────

interface EditUpdateFormProps {
  initialBody: string;
  initialHealth: string;
  onClose: () => void;
  updateId: string;
}

function EditUpdateForm({ updateId, initialBody, initialHealth, onClose }: EditUpdateFormProps) {
  const [body, setBody] = useState(initialBody);
  const [health, setHealth] = useState(initialHealth);
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await gql(
        `mutation ($id: ID!, $input: ProjectUpdateUpdateInput!) {
          projectUpdateUpdate(id: $id, input: $input) { success }
        }`,
        { id: updateId, input: { body: body.trim(), health: health || null } },
      );
      onClose();
    } catch {
      toast.error('Failed to save update');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-300 p-4 dark:border-indigo-700">
      <UpdateFormFields
        body={body}
        health={health}
        onBodyChange={setBody}
        onHealthChange={setHealth}
        showNone
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          className="rounded px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={!body.trim() || submitting}
          onClick={handleSave}
          type="button"
        >
          {submitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
