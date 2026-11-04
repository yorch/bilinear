'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { useTranslations } from '@/hooks/use-translations';

interface ConfirmDialogProps {
  /** Extra content under the message — e.g. a choice the confirmation depends on. */
  children?: React.ReactNode;
  /** Keeps the confirm button disabled for a reason the dialog can't see itself. */
  confirmDisabled?: boolean;
  /** Confirm button label; defaults to common.delete. */
  confirmLabel?: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  /**
   * When set, the confirm button stays disabled until the user types this text
   * exactly — for actions whose blast radius deserves more than a click (a
   * team delete, an organisation archive).
   */
  requireText?: string;
  title: string;
}

/**
 * Shared confirmation dialog for destructive actions. Confirm is styled
 * destructive; Escape/backdrop cancel via ModalDialog's native handling.
 */
export function ConfirmDialog({
  children,
  confirmDisabled = false,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  requireText,
  title,
}: ConfirmDialogProps) {
  const t = useTranslations();
  const fieldId = useId();
  const [typed, setTyped] = useState('');

  // Each open starts with an empty field so a cancelled attempt can't pre-arm
  // the next one.
  useEffect(() => {
    if (open) {
      setTyped('');
    }
  }, [open]);

  const typedOk = requireText === undefined || typed.trim() === requireText.trim();

  return (
    <ModalDialog aria-label={title} onClose={onCancel} open={open}>
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {children}
        {requireText !== undefined && (
          <div className="mt-3">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={fieldId}>
              {t('common.typeToConfirm', { text: requireText })}
            </label>
            <Input
              autoComplete="off"
              id={fieldId}
              onChange={e => setTyped(e.target.value)}
              value={typed}
            />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          {t('common.cancel')}
        </Button>
        <Button
          disabled={!typedOk || confirmDisabled}
          onClick={onConfirm}
          size="sm"
          type="button"
          variant="destructive"
        >
          {confirmLabel ?? t('common.delete')}
        </Button>
      </div>
    </ModalDialog>
  );
}
