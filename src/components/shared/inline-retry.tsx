'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

interface InlineRetryProps {
  className?: string;
  message: string;
  onRetry: () => void;
}

/**
 * Compact "couldn't load — retry" affordance for supplementary sections
 * (reactions, activity, comments, attachments) whose initial fetch fails.
 * Distinguishes "failed to load" from a legitimate empty state instead of
 * silently swallowing the error.
 */
export function InlineRetry({ message, onRetry, className }: InlineRetryProps) {
  const t = useTranslations();
  return (
    <div className={cn('flex items-center gap-2 py-4 text-xs text-destructive', className)}>
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
      <button className="font-medium text-primary hover:underline" onClick={onRetry} type="button">
        {t('common.retry')}
      </button>
    </div>
  );
}
