'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ModalDialog, ModalFooter, ModalHeader } from '@/components/ui/modal-dialog';
import { useTranslations } from '@/hooks/use-translations';

interface PromptDialogProps {
  /** Confirm button label; defaults to common.save. */
  confirmLabel?: string;
  /** Visible label for the text field — also its accessible name. */
  label: string;
  onCancel: () => void;
  /** Receives the raw field value; the caller decides how to trim/interpret it. */
  onSubmit: (value: string) => void;
  open: boolean;
  placeholder?: string;
  title: string;
}

/**
 * Shared single-field prompt for actions that need one short string before they
 * run. The counterpart to `ConfirmDialog`, and preferred over `window.prompt`
 * for the same reasons: a native prompt is unstyled, untranslatable, blocks the
 * main thread, is suppressible by the browser, and gives the operator no context
 * beyond one line of text.
 *
 * Submitting is allowed with an empty field — "no reason given" is a legitimate
 * answer for the suspension flows this backs. Cancelling calls `onCancel` and
 * nothing else, matching `window.prompt` returning null.
 */
export function PromptDialog({
  confirmLabel,
  label,
  onCancel,
  onSubmit,
  open,
  placeholder,
  title,
}: PromptDialogProps) {
  const t = useTranslations();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  // Each open starts from a clean field rather than the previous answer, and
  // focus lands on that field. `autoFocus` cannot do this: React applies it
  // during commit, which runs *before* ModalDialog's effect calls `showModal()`,
  // and focusing a still-`display:none` dialog child is a silent no-op. Doing it
  // in a passive effect puts it after the dialog is genuinely open.
  useEffect(() => {
    if (open) {
      setValue('');
      inputRef.current?.focus();
    }
  }, [open]);

  return (
    <ModalDialog aria-label={title} onClose={onCancel} open={open}>
      <form
        onSubmit={e => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <ModalHeader title={title} />
        <div className="px-5 py-4">
          <label className="block text-xs text-muted-foreground" htmlFor={fieldId}>
            {label}
          </label>
          <Input
            className="mt-1"
            id={fieldId}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            ref={inputRef}
            value={value}
          />
        </div>
        <ModalFooter
          cancelLabel={t('common.cancel')}
          onCancel={onCancel}
          submitLabel={confirmLabel ?? t('common.save')}
        />
      </form>
    </ModalDialog>
  );
}
