'use client';

import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

/**
 * Surfaces the WebSocket connection state that syncStore already tracks:
 * a pill while disconnected, plus one-shot toasts on lost/restored
 * transitions. Renders nothing while connected or during initial bootstrap.
 */
export const ConnectionStatus = observer(function ConnectionStatus({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { syncStore } = useStore();
  const t = useTranslations();
  const connected = syncStore.wsConnected;
  // null until the first observation so the initial state never toasts;
  // everConnected gates the "back online" toast to real reconnects.
  const prev = useRef<boolean | null>(null);
  const everConnected = useRef(false);

  useEffect(() => {
    if (prev.current !== null && connected !== prev.current) {
      if (connected && everConnected.current) {
        toast.success(t('sync.backOnline'));
      } else if (!connected && everConnected.current) {
        toast.warning(t('sync.connectionLost'));
      }
    }
    if (connected) {
      everConnected.current = true;
    }
    prev.current = connected;
  }, [connected, t]);

  const bootstrapping = syncStore.status === 'idle' || syncStore.status === 'bootstrapping';
  if (connected || bootstrapping) {
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
