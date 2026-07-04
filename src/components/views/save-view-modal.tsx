'use client';

import { useEffect, useRef, useState } from 'react';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { useTranslations } from '@/hooks/use-translations';
import { cn, getErrorMessage } from '@/lib/utils';

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
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('properties.saveView.title')}
          </h2>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              htmlFor="view-name"
            >
              {t('properties.saveView.name')}
            </label>
            <input
              className="rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:text-zinc-100"
              id="view-name"
              onChange={e => setName(e.target.value)}
              placeholder={t('properties.saveView.namePlaceholder')}
              ref={nameRef}
              required
              type="text"
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              htmlFor="view-description"
            >
              {t('properties.saveView.description')}
              <span className="ml-1 font-normal text-zinc-400">
                ({t('properties.saveView.optional')})
              </span>
            </label>
            <textarea
              className="resize-none rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-600 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:text-zinc-400"
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
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600"
              onChange={e => setShared(e.target.checked)}
              type="checkbox"
            />
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('properties.saveView.shareWithTeam')}
              </p>
              <p className="text-xs text-zinc-400">{t('properties.saveView.shareDescription')}</p>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          {submitError && <p className="flex-1 text-xs text-red-500">{submitError}</p>}
          <button
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            onClick={onClose}
            type="button"
          >
            {t('common.cancel')}
          </button>
          <button
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
              'bg-indigo-600 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
            )}
            disabled={!canSubmit}
            type="submit"
          >
            {submitting ? t('common.saving') : t('properties.saveView.saveView')}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
