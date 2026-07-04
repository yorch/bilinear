'use client';

import { useTranslations } from '@/hooks/use-translations';
import { PROJECT_HEALTH_LABEL_KEYS, PROJECT_HEALTH_OPTIONS } from '@/lib/project-constants';
import { cn } from '@/lib/utils';

interface UpdateFormFieldsProps {
  body: string;
  health: string;
  onBodyChange: (value: string) => void;
  onHealthChange: (value: string) => void;
  placeholder?: string;
  showNone?: boolean;
}

export function UpdateFormFields({
  body,
  health,
  onBodyChange,
  onHealthChange,
  placeholder,
  showNone = false,
}: UpdateFormFieldsProps) {
  const t = useTranslations();
  return (
    <>
      <div className="mb-3 flex gap-1">
        <span className="mr-1 self-center text-xs text-zinc-500 dark:text-zinc-400">
          {t('properties.updateForm.health.label')}
        </span>
        {showNone && (
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              health === ''
                ? 'bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-100'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
            )}
            onClick={() => onHealthChange('')}
            type="button"
          >
            {t('properties.updateForm.health.none')}
          </button>
        )}
        {PROJECT_HEALTH_OPTIONS.map(h => (
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              health === h.value
                ? `${h.color} text-white`
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
            )}
            key={h.value}
            onClick={() => onHealthChange(h.value)}
            type="button"
          >
            {t(PROJECT_HEALTH_LABEL_KEYS[h.value] ?? h.label)}
          </button>
        ))}
      </div>
      <textarea
        className="w-full resize-none rounded border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
        onChange={e => onBodyChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        value={body}
      />
    </>
  );
}
