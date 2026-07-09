'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ModalDialog, ModalFooter, ModalHeader } from '@/components/ui/modal-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/hooks/use-translations';
import { cn, getErrorMessage } from '@/lib/utils';

interface CreateTeamInput {
  description?: string;
  key: string;
  name: string;
  private: boolean;
}

interface CreateTeamModalProps {
  onClose: () => void;
  onSubmit: (input: CreateTeamInput) => Promise<void>;
  open: boolean;
}

/** Derive a team key from the team name (e.g. "Engineering" → "ENG"). */
function deriveKey(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  if (words.length === 1) {
    return words[0]
      .slice(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
  }
  return words
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 10);
}

const KEY_PATTERN = /^[A-Z]{1,10}$/;

export function CreateTeamModal({ open, onClose, onSubmit }: CreateTeamModalProps) {
  const t = useTranslations();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Reset form on open
  useEffect(() => {
    if (open) {
      setName('');
      setKey('');
      setKeyTouched(false);
      setDescription('');
      setIsPrivate(false);
      setSubmitting(false);
      setKeyError('');
      setSubmitError('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-derive key from name unless user has manually edited it
  useEffect(() => {
    if (!keyTouched) {
      setKey(deriveKey(name));
    }
  }, [name, keyTouched]);

  const handleKeyChange = (value: string) => {
    const upper = value
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 10);
    setKey(upper);
    setKeyTouched(true);
    setKeyError('');
    setSubmitError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !key || !KEY_PATTERN.test(key) || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        description: description.trim() || undefined,
        key,
        name: name.trim(),
        private: isPrivate,
      });
      onClose();
    } catch (err) {
      const msg = getErrorMessage(err, t('teams.failedToCreate'));
      // Duplicate key errors shown inline; others go to the action bar
      if (msg.toLowerCase().includes('key')) {
        setKeyError(msg);
      } else {
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && KEY_PATTERN.test(key) && !submitting;

  return (
    <ModalDialog aria-label={t('teams.createTeam')} onClose={onClose} open={open}>
      <form className="flex flex-col" onSubmit={handleSubmit}>
        <ModalHeader title={t('teams.createTeam')} />

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="team-name">
              {t('teams.name')}
            </label>
            <Input
              id="team-name"
              onChange={e => setName(e.target.value)}
              placeholder={t('teams.namePlaceholder')}
              ref={nameRef}
              required
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="team-key">
              {t('teams.identifier')}
              <span className="ml-1 font-normal text-muted-foreground">
                {t('teams.identifierHint')}
              </span>
            </label>
            <input
              className={cn(
                'rounded-md border bg-transparent px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground outline-none',
                keyError
                  ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                  : 'border-border focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
              )}
              id="team-key"
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="ENG"
              required
              type="text"
              value={key}
            />
            {keyError && <p className="text-xs text-red-500">{keyError}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="team-description">
              {t('teams.description')}
              <span className="ml-1 font-normal text-muted-foreground">
                ({t('teams.optional')})
              </span>
            </label>
            <Textarea
              className="resize-none"
              id="team-description"
              onChange={e => setDescription(e.target.value)}
              placeholder={t('teams.descriptionPlaceholder')}
              rows={2}
              value={description}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              checked={isPrivate}
              className="h-4 w-4 rounded border-border text-indigo-600 focus:ring-indigo-500"
              onChange={e => setIsPrivate(e.target.checked)}
              type="checkbox"
            />
            <div>
              <p className="text-sm font-medium text-foreground-secondary">
                {t('teams.privateTeam')}
              </p>
              <p className="text-xs text-muted-foreground">{t('teams.privateTeamHint')}</p>
            </div>
          </label>
        </div>

        <ModalFooter
          cancelLabel={t('common.cancel')}
          onCancel={onClose}
          submitDisabled={!canSubmit}
          submitError={submitError}
          submitLabel={submitting ? t('teams.creating') : t('teams.createTeam')}
        />
      </form>
    </ModalDialog>
  );
}
