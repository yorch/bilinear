'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';

interface DeleteUpdateButtonProps {
  mutation: string;
  onDeleted?: () => void;
  updateId: string;
}

export function DeleteUpdateButton({ updateId, mutation, onDeleted }: DeleteUpdateButtonProps) {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await gql(mutation, { id: updateId });
      onDeleted?.();
    } catch {
      toast.error(t('properties.updateForm.failedToDeleteUpdate'));
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">
          {t('properties.updateForm.deleteConfirm')}
        </span>
        <button
          className="rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          disabled={deleting}
          onClick={handleDelete}
          type="button"
        >
          {deleting ? '...' : t('properties.updateForm.yes')}
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => setConfirming(false)}
          type="button"
        >
          {t('properties.updateForm.no')}
        </button>
      </div>
    );
  }

  return (
    <button
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-500"
      onClick={() => setConfirming(true)}
      title={t('common.delete')}
      type="button"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
