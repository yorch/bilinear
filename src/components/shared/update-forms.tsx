'use client';

import { MessageSquare, X } from 'lucide-react';
import { useState } from 'react';
import { UpdateFormFields } from '@/components/shared/update-form-fields';
import { useTranslations } from '@/hooks/use-translations';
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
  placeholder,
  showNone,
}: CreateUpdateFormProps) {
  const t = useTranslations();
  const [body, setBody] = useState('');
  const [health, setHealth] = useState(initialHealth);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    let succeeded = false;
    try {
      await onSubmit(body.trim(), health);
      succeeded = true;
    } catch {
      toast.error(t('properties.updateForm.failedToPostUpdate'));
    } finally {
      setSubmitting(false);
    }
    if (succeeded) {
      onClose();
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 pb-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          {t('properties.updateForm.newUpdate')}
        </span>
        <button
          aria-label={t('common.close')}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-zinc-600 dark:hover:text-zinc-300"
          onClick={onClose}
          title={t('common.close')}
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
        placeholder={placeholder ?? t('properties.updateForm.bodyPlaceholder')}
        showNone={showNone}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={onClose}
          type="button"
        >
          {t('common.cancel')}
        </button>
        <button
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          disabled={!body.trim() || submitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitting ? t('properties.updateForm.posting') : t('properties.updateForm.postUpdate')}
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
  const t = useTranslations();
  const [body, setBody] = useState(initialBody);
  const [health, setHealth] = useState(initialHealth);
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (!body.trim()) {
      return;
    }
    setSubmitting(true);
    let succeeded = false;
    try {
      await onSave(body.trim(), health);
      succeeded = true;
    } catch {
      toast.error(t('properties.updateForm.failedToSaveUpdate'));
    } finally {
      setSubmitting(false);
    }
    if (succeeded) {
      onClose();
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
          className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={onClose}
          type="button"
        >
          {t('common.cancel')}
        </button>
        <button
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          disabled={!body.trim() || submitting}
          onClick={handleSave}
          type="button"
        >
          {submitting ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
