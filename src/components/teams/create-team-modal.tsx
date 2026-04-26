'use client';

import { useEffect, useRef, useState } from 'react';
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
      const msg = getErrorMessage(err, 'Failed to create team');
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

  if (!open) {
    return null;
  }

  const canSubmit = name.trim().length > 0 && KEY_PATTERN.test(key) && !submitting;

  return (
    <dialog
      aria-label="Create team"
      className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/40 p-0 m-0 border-none max-w-none max-h-none"
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      open
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Create team</h2>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                htmlFor="team-name"
              >
                Name
              </label>
              <input
                className="rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:text-zinc-100"
                id="team-name"
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Engineering"
                ref={nameRef}
                required
                type="text"
                value={name}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                htmlFor="team-key"
              >
                Identifier
                <span className="ml-1 font-normal text-zinc-400">
                  (used in issue IDs like ENG-123)
                </span>
              </label>
              <input
                className={cn(
                  'rounded-md border bg-transparent px-3 py-1.5 font-mono text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100',
                  keyError
                    ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                    : 'border-zinc-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700',
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
              <label
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                htmlFor="team-description"
              >
                Description
                <span className="ml-1 font-normal text-zinc-400">(optional)</span>
              </label>
              <textarea
                className="resize-none rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-600 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:text-zinc-400"
                id="team-description"
                onChange={e => setDescription(e.target.value)}
                placeholder="What does this team work on?"
                rows={2}
                value={description}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                checked={isPrivate}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600"
                onChange={e => setIsPrivate(e.target.checked)}
                type="checkbox"
              />
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Private team</p>
                <p className="text-xs text-zinc-400">
                  Only members can see this team and its issues
                </p>
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
              Cancel
            </button>
            <button
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
                'bg-indigo-600 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
              )}
              disabled={!canSubmit}
              type="submit"
            >
              {submitting ? 'Creating…' : 'Create team'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
