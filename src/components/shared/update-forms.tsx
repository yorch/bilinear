'use client';

import { MessageSquare, X } from 'lucide-react';
import { useState } from 'react';
import { UpdateFormFields } from '@/components/shared/update-form-fields';
import { toast } from '@/lib/toast';

// ─── Create form ─────────────────────────────────────────────────────────────

interface CreateUpdateFormProps {
  initialHealth?: string;
  onClose: () => void;
  /** Receives trimmed body and current health; throws on failure. */
  onSubmit: (body: string, health: string) => Promise<void>;
  placeholder?: string;
  showNone?: boolean;
}

export function CreateUpdateForm({
  initialHealth = '',
  onClose,
  onSubmit,
  placeholder = 'Describe the current status, blockers, or progress...',
  showNone,
}: CreateUpdateFormProps) {
  const [body, setBody] = useState('');
  const [health, setHealth] = useState(initialHealth);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(body.trim(), health);
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
        placeholder={placeholder}
        showNone={showNone}
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
  /** Receives trimmed body and current health; throws on failure. */
  onSave: (body: string, health: string) => Promise<void>;
  showNone?: boolean;
}

export function EditUpdateForm({
  initialBody,
  initialHealth,
  onClose,
  onSave,
  showNone,
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
      await onSave(body.trim(), health);
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
        showNone={showNone}
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
