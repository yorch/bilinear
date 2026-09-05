'use client';

import { type FormEvent, useState } from 'react';
import { fromDateInputValue, toDateInputValue } from '@/components/teams/team-settings-helpers';
import { Input } from '@/components/ui/input';
import { ModalDialog, ModalFooter, ModalHeader } from '@/components/ui/modal-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCycle } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { CYCLE_CREATE_MUTATION } from '@/lib/graphql-queries';
import { getErrorMessage } from '@/lib/utils';

interface CreateCycleModalProps {
  /** Suggested duration for the default end date, in weeks. */
  defaultDurationWeeks?: number;
  onClose: () => void;
  onCreated: (cycle: DBCycle) => void;
  open: boolean;
  teamId: string;
}

/** Default range: today → today + duration (weeks), as `yyyy-mm-dd` values. */
export function defaultCycleRange(durationWeeks: number, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, durationWeeks) * 7 - 1);
  return { end: toDateInputValue(end.toISOString()), start: toDateInputValue(start.toISOString()) };
}

/** True when both dates parse and the end is not before the start. */
export function isValidCycleRange(start: string, end: string): boolean {
  const s = fromDateInputValue(start);
  const e = fromDateInputValue(end, true);
  return s !== null && e !== null && e > s;
}

export function CreateCycleModal({
  defaultDurationWeeks = 2,
  onClose,
  onCreated,
  open,
  teamId,
}: CreateCycleModalProps) {
  const t = useTranslations();
  const initial = defaultCycleRange(defaultDurationWeeks);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const rangeValid = isValidCycleRange(startDate, endDate);
  const canSubmit = rangeValid && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const data = await gqlMutate(CYCLE_CREATE_MUTATION, {
        input: {
          description: description.trim() || null,
          endsAt: fromDateInputValue(endDate, true),
          name: name.trim() || null,
          startsAt: fromDateInputValue(startDate),
          teamId,
        },
      });
      const cycle = (data.cycleCreate as { cycle?: DBCycle } | undefined)?.cycle;
      if (!cycle) {
        throw new Error(t('cycles.create.failed'));
      }
      onCreated(cycle);
      onClose();
    } catch (err) {
      setSubmitError(getErrorMessage(err, t('cycles.create.failed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog aria-label={t('cycles.create.title')} onClose={onClose} open={open}>
      <form className="flex flex-col" onSubmit={handleSubmit}>
        <ModalHeader title={t('cycles.create.title')} />

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="cycle-name">
              {t('cycles.create.name')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('cycles.create.optional')})
              </span>
            </label>
            <Input
              data-autofocus
              id="cycle-name"
              onChange={e => setName(e.target.value)}
              placeholder={t('cycles.create.namePlaceholder')}
              value={name}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="cycle-start">
                {t('cycles.create.startDate')}
              </label>
              <Input
                id="cycle-start"
                onChange={e => setStartDate(e.target.value)}
                required
                type="date"
                value={startDate}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="cycle-end">
                {t('cycles.create.endDate')}
              </label>
              <Input
                id="cycle-end"
                onChange={e => setEndDate(e.target.value)}
                required
                type="date"
                value={endDate}
              />
            </div>
          </div>
          {!rangeValid && (
            <p className="text-xs text-danger-subtle-foreground">
              {t('cycles.create.invalidRange')}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="cycle-description"
            >
              {t('cycles.create.description')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('cycles.create.optional')})
              </span>
            </label>
            <Textarea
              className="resize-none"
              id="cycle-description"
              onChange={e => setDescription(e.target.value)}
              placeholder={t('cycles.create.descriptionPlaceholder')}
              rows={3}
              value={description}
            />
          </div>
        </div>

        <ModalFooter
          cancelLabel={t('common.cancel')}
          onCancel={onClose}
          submitDisabled={!canSubmit}
          submitError={submitError}
          submitLabel={submitting ? t('cycles.create.creating') : t('cycles.create.submit')}
        />
      </form>
    </ModalDialog>
  );
}
