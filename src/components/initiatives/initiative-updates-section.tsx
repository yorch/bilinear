'use client';

import { MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
import { PROJECT_HEALTH_CONFIG, PROJECT_HEALTH_OPTIONS } from '@/lib/project-constants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface InitiativeUpdate {
  body: string;
  createdAt: string;
  editedAt: string | null;
  health: string | null;
  id: string;
  user: { id: string; displayName: string };
}

interface InitiativeUpdatesSectionProps {
  initiativeId: string;
  viewerId: string;
}

const FETCH_QUERY = `
  query InitiativeUpdates($id: ID!) {
    initiative(id: $id) {
      id
      updates {
        id
        body
        health
        editedAt
        createdAt
        user { id displayName }
      }
    }
  }
`;

const CREATE_MUTATION = `
  mutation InitiativeUpdateCreate($input: InitiativeUpdateCreateInput!) {
    initiativeUpdateCreate(input: $input) {
      success
      initiativeUpdate {
        id body health editedAt createdAt user { id displayName }
      }
    }
  }
`;

const EDIT_MUTATION = `
  mutation InitiativeUpdateEdit($id: ID!, $input: InitiativeUpdateEditInput!) {
    initiativeUpdateUpdate(id: $id, input: $input) {
      success
      initiativeUpdate {
        id body health editedAt createdAt user { id displayName }
      }
    }
  }
`;

const DELETE_MUTATION = `
  mutation InitiativeUpdateDelete($id: ID!) {
    initiativeUpdateDelete(id: $id) { success }
  }
`;

export function InitiativeUpdatesSection({
  initiativeId,
  viewerId,
}: InitiativeUpdatesSectionProps) {
  const [updates, setUpdates] = useState<InitiativeUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchUpdates = useCallback(async () => {
    try {
      const res = await gql(FETCH_QUERY, { id: initiativeId });
      const data = res.data as { initiative?: { updates: InitiativeUpdate[] } } | undefined;
      setUpdates(data?.initiative?.updates ?? []);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  const openCreate = () => {
    setEditingId(null);
    setCreating(true);
  };

  const openEdit = (id: string) => {
    setCreating(false);
    setEditingId(id);
  };

  if (loading) {
    return <div className="mt-3 text-xs text-zinc-400">Loading updates…</div>;
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Updates ({updates.length})
        </h4>
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
          initiativeId={initiativeId}
          onClose={() => setCreating(false)}
          onCreated={fetchUpdates}
        />
      )}

      {updates.length === 0 && !creating ? (
        <p className="py-4 text-center text-xs text-zinc-400">
          No updates yet. Share initiative health and progress.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {updates.map(update => {
            const isOwner = update.user.id === viewerId;
            const health = update.health ? PROJECT_HEALTH_CONFIG[update.health] : null;

            if (editingId === update.id) {
              return (
                <EditUpdateForm
                  initialBody={update.body}
                  initialHealth={update.health ?? ''}
                  key={update.id}
                  onClose={() => setEditingId(null)}
                  onSaved={fetchUpdates}
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
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {update.user.displayName}
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
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        onClick={() => openEdit(update.id)}
                        title="Edit"
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <DeleteUpdateButton onDeleted={fetchUpdates} updateId={update.id} />
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
}

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
        <span className="mr-1 self-center text-xs text-zinc-500 dark:text-zinc-400">Health:</span>
        {PROJECT_HEALTH_OPTIONS.map(h => (
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              health === h.value
                ? `${h.color} text-white`
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
            )}
            key={h.value}
            onClick={() => onHealthChange(h.value)}
            type="button"
          >
            {h.label}
          </button>
        ))}
      </div>
      <textarea
        className="w-full resize-none rounded border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
        onChange={e => onBodyChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        value={body}
      />
    </>
  );
}

// ─── Create form ─────────────────────────────────────────────────────────────

interface CreateUpdateFormProps {
  initiativeId: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateUpdateForm({ initiativeId, onClose, onCreated }: CreateUpdateFormProps) {
  const [body, setBody] = useState('');
  const [health, setHealth] = useState('onTrack');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await gql(CREATE_MUTATION, {
        input: {
          body: body.trim(),
          bodyData: {},
          health,
          initiativeId,
        },
      });
      if (res.errors?.length) {
        throw new Error('mutation failed');
      }
      await onCreated();
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
  onSaved: () => void;
  updateId: string;
}

function EditUpdateForm({
  updateId,
  initialBody,
  initialHealth,
  onClose,
  onSaved,
}: EditUpdateFormProps) {
  const [body, setBody] = useState(initialBody);
  const [health, setHealth] = useState(initialHealth || 'onTrack');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await gql(EDIT_MUTATION, {
        id: updateId,
        input: { body: body.trim(), bodyData: {}, health },
      });
      if (res.errors?.length) {
        throw new Error('mutation failed');
      }
      await onSaved();
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

// ─── Delete button ────────────────────────────────────────────────────────────

function DeleteUpdateButton({ updateId, onDeleted }: { updateId: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await gql(DELETE_MUTATION, { id: updateId });
      if (res.errors?.length) {
        throw new Error('mutation failed');
      }
      await onDeleted();
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
          className="rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          disabled={deleting}
          onClick={handleDelete}
          type="button"
        >
          {deleting ? '...' : 'Yes'}
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={() => setConfirming(false)}
          type="button"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
      onClick={() => setConfirming(true)}
      title="Delete"
      type="button"
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
