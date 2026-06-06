'use client';

import { MessageSquare, Pencil, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { UpdateFormFields } from '@/components/shared/update-form-fields';
import { Badge } from '@/components/ui/badge';
import { gql } from '@/lib/graphql';
import {
  INITIATIVE_UPDATE_CREATE_MUTATION,
  INITIATIVE_UPDATE_EDIT_MUTATION,
  INITIATIVE_UPDATES_QUERY,
} from '@/lib/graphql-queries';
import { PROJECT_HEALTH_CONFIG } from '@/lib/project-constants';
import { toast } from '@/lib/toast';
import { formatRelativeTime } from '@/lib/utils';

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
      const res = await gql(INITIATIVE_UPDATES_QUERY, { id: initiativeId });
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
                        mutation={`mutation ($id: ID!) { initiativeUpdateDelete(id: $id) { success } }`}
                        onDeleted={fetchUpdates}
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
      const res = await gql(INITIATIVE_UPDATE_CREATE_MUTATION, {
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
      const res = await gql(INITIATIVE_UPDATE_EDIT_MUTATION, {
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
