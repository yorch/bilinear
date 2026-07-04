'use client';

import { Button } from '@/components/ui/button';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { useTranslations } from '@/hooks/use-translations';

interface ConfirmDialogProps {
  /** Confirm button label; defaults to common.delete. */
  confirmLabel?: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}

/**
 * Shared confirmation dialog for destructive actions. Confirm is styled
 * destructive; Escape/backdrop cancel via ModalDialog's native handling.
 */
export function ConfirmDialog({
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  const t = useTranslations();

  return (
    <ModalDialog aria-label={title} onClose={onCancel} open={open}>
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} size="sm" type="button" variant="destructive">
          {confirmLabel ?? t('common.delete')}
        </Button>
      </div>
    </ModalDialog>
  );
}
