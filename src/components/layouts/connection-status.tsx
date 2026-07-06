'use client';

import { observer } from 'mobx-react-lite';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

/**
 * Presentational pill surfacing the WebSocket connection state syncStore
 * already tracks. Renders nothing while connected or during initial
 * bootstrap. Transition toasts live in ConnectionToasts (always mounted in
 * WorkspaceClient) — this pill remounts on sidebar collapse toggles.
 */
export const ConnectionStatus = observer(function ConnectionStatus({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { syncStore } = useStore();
  const t = useTranslations();

  const bootstrapping = syncStore.status === 'idle' || syncStore.status === 'bootstrapping';
  if (syncStore.wsConnected || bootstrapping) {
    return null;
  }

  const label = syncStore.status === 'offline' ? t('sync.offline') : t('sync.reconnecting');

  return (
    <div
      className="flex items-center justify-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      role="status"
      title={label}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      {!compact && label}
    </div>
  );
});
