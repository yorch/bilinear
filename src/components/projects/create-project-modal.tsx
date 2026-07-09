'use client';

import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ModalDialog, ModalFooter, ModalHeader } from '@/components/ui/modal-dialog';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/hooks/use-translations';
import { cn, getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface CreateProjectModalProps {
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    description?: string;
    statusType: string;
    teamIds: string[];
    leadId?: string;
    startDate?: string;
    targetDate?: string;
  }) => Promise<void>;
  open: boolean;
}

export const CreateProjectModal = observer(function CreateProjectModal({
  open,
  onClose,
  onSubmit,
}: CreateProjectModalProps) {
  const t = useTranslations();
  const { teamStore } = useStore();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statusType, setStatusType] = useState('planned');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const teams = teamStore.all;

  const STATUS_OPTIONS = [
    { label: t('projects.status.backlog'), value: 'backlog' },
    { label: t('projects.status.planned'), value: 'planned' },
    { label: t('projects.status.inProgress'), value: 'inProgress' },
  ] as const;

  // Reset form state only on open transitions — including `teams` here
  // re-fires the effect whenever the MobX-derived array gets a new identity
  // (every parent render), which wipes user input mid-typing.
  useEffect(() => {
    if (!open) {
      return;
    }
    setName('');
    setDescription('');
    setStatusType('planned');
    setSelectedTeamIds([]);
    setStartDate('');
    setTargetDate('');
    setSubmitting(false);
    setSubmitError('');
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  // Default-select the first team when the modal opens or when teams arrive
  // after the initial open. Don't clobber an explicit user selection.
  useEffect(() => {
    if (open && teams.length > 0) {
      setSelectedTeamIds(prev => (prev.length === 0 ? [teams[0].id] : prev));
    }
  }, [open, teams]);

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds(prev =>
      prev.includes(teamId) ? prev.filter(id => id !== teamId) : [...prev, teamId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedTeamIds.length === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        description: description.trim() || undefined,
        name: name.trim(),
        startDate: startDate || undefined,
        statusType,
        targetDate: targetDate || undefined,
        teamIds: selectedTeamIds,
      });
      onClose();
    } catch (err) {
      setSubmitError(getErrorMessage(err, t('projects.failedToCreate')));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && selectedTeamIds.length > 0 && !submitting;

  return (
    <ModalDialog aria-label={t('projects.createProject')} onClose={onClose} open={open}>
      <form className="flex flex-col" onSubmit={handleSubmit}>
        <ModalHeader title={t('projects.createProject')} />

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="project-name">
              {t('projects.name')}
            </label>
            <Input
              id="project-name"
              onChange={e => setName(e.target.value)}
              placeholder={t('projects.namePlaceholder')}
              ref={nameRef}
              required
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="project-description"
            >
              {t('projects.description')}{' '}
              <span className="font-normal text-muted-foreground">({t('projects.optional')})</span>
            </label>
            <Textarea
              className="resize-none"
              id="project-description"
              onChange={e => setDescription(e.target.value)}
              placeholder={t('projects.descriptionPlaceholder')}
              rows={2}
              value={description}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="project-status">
              {t('projects.status.label')}
            </label>
            <SimpleSelect
              id="project-status"
              onChange={setStatusType}
              options={STATUS_OPTIONS}
              value={statusType}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('projects.teams')}</span>
            <div className="flex flex-wrap gap-2">
              {teams.map(team => (
                <button
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    selectedTeamIds.includes(team.id)
                      ? 'border-brand bg-brand-subtle text-brand-subtle-foreground dark:bg-brand-subtle dark:text-brand-subtle-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                  key={team.id}
                  onClick={() => toggleTeam(team.id)}
                  type="button"
                >
                  {team.icon ? `${team.icon} ` : ''}
                  {team.name}
                </button>
              ))}
            </div>
            {teams.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('projects.noTeamsAvailable')}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="project-start">
                {t('projects.startDate')}{' '}
                <span className="font-normal text-muted-foreground">
                  ({t('projects.optional')})
                </span>
              </label>
              <Input
                id="project-start"
                onChange={e => setStartDate(e.target.value)}
                type="date"
                value={startDate}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="project-target">
                {t('projects.targetDate')}{' '}
                <span className="font-normal text-muted-foreground">
                  ({t('projects.optional')})
                </span>
              </label>
              <Input
                id="project-target"
                onChange={e => setTargetDate(e.target.value)}
                type="date"
                value={targetDate}
              />
            </div>
          </div>
        </div>

        <ModalFooter
          cancelLabel={t('common.cancel')}
          onCancel={onClose}
          submitDisabled={!canSubmit}
          submitError={submitError}
          submitLabel={submitting ? t('projects.creating') : t('projects.createProject')}
        />
      </form>
    </ModalDialog>
  );
});
