'use client';

import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

interface SyncErrorStateProps {
  message: string;
}

/**
 * Full-page fallback for `syncStore.status === 'error'` (bootstrap failed).
 * Retry re-runs SyncProvider's init effect via `syncStore.retryBootstrap()`.
 */
export function SyncErrorState({ message }: SyncErrorStateProps) {
  const t = useTranslations();
  const { syncStore } = useStore();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-destructive">
      <span>{message}</span>
      <button
        className="font-medium text-primary hover:underline"
        onClick={() => syncStore.retryBootstrap()}
        type="button"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}
