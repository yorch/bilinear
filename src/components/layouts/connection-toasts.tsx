'use client';

import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

/**
 * One-shot toasts on WebSocket lost/restored transitions. Lives in its own
 * always-mounted component (rendered once in WorkspaceClient) rather than in
 * the sidebar's ConnectionStatus pill — the pill remounts on every sidebar
 * collapse toggle, which would reset the transition-tracking refs and
 * swallow the "back online" toast.
 */
export const ConnectionToasts = observer(function ConnectionToasts() {
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

  return null;
});
