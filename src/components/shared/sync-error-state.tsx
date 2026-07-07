'use client';

import { observer } from 'mobx-react-lite';
import { InlineRetry } from '@/components/shared/inline-retry';
import { useStore } from '@/providers/store-provider';

interface SyncErrorStateProps {
  message: string;
}

/**
 * Full-page fallback for `syncStore.status === 'error'` (bootstrap failed).
 * Retry re-runs SyncProvider's init effect via `syncStore.retryBootstrap()`.
 */
export const SyncErrorState = observer(function SyncErrorState({ message }: SyncErrorStateProps) {
  const { syncStore } = useStore();

  return (
    <InlineRetry
      className="flex-1 flex-col items-center justify-center"
      message={message}
      onRetry={() => syncStore.retryBootstrap()}
    />
  );
});
