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
        <span className="mr-1 self-center text-xs text-muted-foreground">
          {t('properties.updateForm.health.label')}
        </span>
        {showNone && (
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              health === ''
                ? 'bg-foreground-faint text-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
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
                : 'bg-muted text-muted-foreground hover:bg-accent',
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
        className="w-full resize-none rounded border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        onChange={e => onBodyChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        value={body}
      />
    </>
  );
}
