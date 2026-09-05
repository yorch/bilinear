'use client';

import { useEffect, useState } from 'react';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { Input } from '@/components/ui/input';
import { ModalDialog, ModalFooter, ModalHeader } from '@/components/ui/modal-dialog';

import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/hooks/use-translations';
import type { FilterSet, SortField } from '@/lib/filter-engine';
import { getErrorMessage } from '@/lib/utils';

export interface SaveViewInput {
  color?: string;
  description?: string;
  filters?: FilterSet;
  groupBy?: string;
  icon?: string;
  layout?: string;
  name: string;
  shared: boolean;
  sort?: SortField[];
  teamId?: string;
}

interface SaveViewModalProps {
  initialFilters?: FilterSet;
  initialGroupBy?: string;
  initialLayout?: string;
  initialSort?: SortField[];
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
              data-autofocus
              id="view-name"
              onChange={e => setName(e.target.value)}
              placeholder={t('properties.saveView.namePlaceholder')}
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

          <SettingToggleRow
            checked={shared}
            description={t('properties.saveView.shareDescription')}
            label={t('properties.saveView.shareWithTeam')}
            onCheckedChange={setShared}
          />
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
