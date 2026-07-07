'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ModalDialog, ModalFooter, ModalHeader } from '@/components/ui/modal-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/hooks/use-translations';
import { getErrorMessage } from '@/lib/utils';

export interface SaveViewInput {
  color?: string;
  description?: string;
  filters?: object;
  groupBy?: string;
  icon?: string;
  layout?: string;
  name: string;
  shared: boolean;
  sort?: object;
  teamId?: string;
}

interface SaveViewModalProps {
  initialFilters?: object;
  initialGroupBy?: string;
  initialLayout?: string;
  initialSort?: object;
  onClose: () => void;
  onSubmit: (input: SaveViewInput) => Promise<void>;
  open: boolean;
  teamId?: string;
}

export function SaveViewModal({
  open,
  onClose,
  onSubmit,
  teamId,
  initialFilters,
  initialSort,
  initialGroupBy,
  initialLayout,
}: SaveViewModalProps) {
  const t = useTranslations();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shared, setShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Reset form on open
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setShared(false);
      setSubmitting(false);
      setSubmitError('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        description: description.trim() || undefined,
        filters: initialFilters,
        groupBy: initialGroupBy,
        layout: initialLayout,
        name: name.trim(),
        shared,
        sort: initialSort,
        teamId,
      });
      onClose();
    } catch (err) {
      setSubmitError(getErrorMessage(err, t('properties.saveView.failedToSaveView')));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && !submitting;

  return (
    <ModalDialog aria-label={t('properties.saveView.title')} onClose={onClose} open={open}>
      <form className="flex flex-col" onSubmit={handleSubmit}>
        <ModalHeader title={t('properties.saveView.title')} />

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="view-name">
              {t('properties.saveView.name')}
            </label>
            <Input
              id="view-name"
              onChange={e => setName(e.target.value)}
              placeholder={t('properties.saveView.namePlaceholder')}
              ref={nameRef}
              required
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="view-description">
              {t('properties.saveView.description')}
              <span className="ml-1 font-normal text-muted-foreground">
                ({t('properties.saveView.optional')})
              </span>
            </label>
            <Textarea
              className="resize-none"
              id="view-description"
              onChange={e => setDescription(e.target.value)}
              placeholder={t('properties.saveView.descriptionPlaceholder')}
              rows={2}
              value={description}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              checked={shared}
              className="h-4 w-4 rounded border-border text-indigo-600 focus:ring-indigo-500"
              onChange={e => setShared(e.target.checked)}
              type="checkbox"
            />
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('properties.saveView.shareWithTeam')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('properties.saveView.shareDescription')}
              </p>
            </div>
          </label>
        </div>

        <ModalFooter
          cancelLabel={t('common.cancel')}
          onCancel={onClose}
          submitDisabled={!canSubmit}
          submitError={submitError}
          submitLabel={submitting ? t('common.saving') : t('properties.saveView.saveView')}
        />
      </form>
    </ModalDialog>
  );
}
