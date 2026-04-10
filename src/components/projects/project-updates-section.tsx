'use client';

import { MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { gql } from '@/lib/graphql';
import {
  PROJECT_HEALTH_CONFIG,
  PROJECT_HEALTH_OPTIONS,
} from '@/lib/project-constants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

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
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add update
          </button>
        )}
      </div>

      {creating && (
        <CreateUpdateForm
          projectId={projectId}
          onClose={() => setCreating(false)}
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
            const health = update.health
              ? PROJECT_HEALTH_CONFIG[update.health]
              : null;

            if (editingId === update.id) {
              return (
                <EditUpdateForm
                  key={update.id}
                  updateId={update.id}
                  initialBody={update.body}
                  initialHealth={update.health ?? ''}
                  onClose={() => setEditingId(null)}
                />
              );
            }

            return (
              <div
                key={update.id}
                className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
                        !author?.avatarBgColor && 'bg-indigo-500',
                      )}
                      style={
                        author?.avatarBgColor
                          ? { backgroundColor: author.avatarBgColor }
                          : undefined
                      }
                    >
                      {author?.initials ?? '?'}
                    </span>
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {author?.displayName ?? 'Unknown'}
                    </span>
                    {health && (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs font-medium text-white',
                          health.color,
                        )}
                      >
                        {health.label}
                      </span>
                    )}
                    <span className="text-xs text-zinc-400">
                      {formatRelativeDate(update.createdAt)}
                      {update.editedAt && ' (edited)'}
                    </span>
                  </div>
                  {isOwner && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(update.id)}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <DeleteUpdateButton updateId={update.id} />
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

// ─── Shared form fields ───────────────────────────────────────────────────────

interface UpdateFormFieldsProps {
  body: string;
  health: string;
  onBodyChange: (value: string) => void;
  onHealthChange: (value: string) => void;
  placeholder?: string;
}

function UpdateFormFields({
  body,
  health,
  onBodyChange,
  onHealthChange,
  placeholder,
}: UpdateFormFieldsProps) {
  return (
    <>
      <div className="mb-3 flex gap-1">
        <span className="mr-1 self-center text-xs text-zinc-500 dark:text-zinc-400">
          Health:
        </span>
        <button
          type="button"
          onClick={() => onHealthChange('')}
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
            health === ''
              ? 'bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-100'
              : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
          )}
        >
          None
        </button>
        {PROJECT_HEALTH_OPTIONS.map(h => (
          <button
            key={h.value}
            type="button"
            onClick={() => onHealthChange(h.value)}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              health === h.value
                ? `${h.color} text-white`
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
            )}
          >
            {h.label}
          </button>
        ))}
      </div>
      <textarea
        className="w-full resize-none rounded border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
        rows={4}
        placeholder={placeholder}
        value={body}
        onChange={e => onBodyChange(e.target.value)}
      />
    </>
  );
}

// ─── Create form ─────────────────────────────────────────────────────────────

interface CreateUpdateFormProps {
  projectId: string;
  onClose: () => void;
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
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          New update
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
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
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!body.trim() || submitting}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Posting...' : 'Post update'}
        </button>
      </div>
    </div>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────────

interface EditUpdateFormProps {
  updateId: string;
  initialBody: string;
  initialHealth: string;
  onClose: () => void;
}

function EditUpdateForm({
  updateId,
  initialBody,
  initialHealth,
  onClose,
}: EditUpdateFormProps) {
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
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!body.trim() || submitting}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Delete button ────────────────────────────────────────────────────────────

function DeleteUpdateButton({ updateId }: { updateId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await gql(
        `mutation ($id: ID!) {
          projectUpdateDelete(id: $id) { success }
        }`,
        { id: updateId },
      );
    } catch {
      toast.error('Failed to delete update');
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-500">Delete?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
        >
          {deleting ? '...' : 'Yes'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
      title="Delete"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? 'just now' : `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return 'yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w ago`;
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
