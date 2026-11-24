'use client';

import { useEffect } from 'react';
import type { DBNotification } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { useStore } from '@/providers/store-provider';
import type { NotificationStore } from '@/stores/notification-store';
import { NOTIFICATIONS_PAGE_QUERY, NOTIFICATIONS_WITH_COUNT_QUERY } from './notification-queries';

/**
 * Keeps `notificationStore` warm for the whole shell, so the Inbox unread
 * badge is correct on every page and not only after the Inbox has been opened.
 *
 * Notifications are not delivered over WebSocket (a notification belongs to
 * one recipient, and SyncActions broadcast org-wide), so this is a fetch on
 * mount plus a refresh whenever the tab becomes visible again and once a minute
 * while it stays visible. Each result reconciles the pool (rows the server
 * dropped, e.g. snoozed elsewhere, leave the badge count). Failures are
 * silent here: the Inbox reads `loadState` from the store and owns the error UI.
 */
const PAGE_LIMIT = 50;
/** Background refresh while the tab stays visible (notifications aren't pushed). */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * Fetch one page and reconcile it into the store. Also the Inbox's retry path.
 * A failure after a successful load keeps the rows already shown; only a
 * never-loaded store reports `error`.
 */
export async function fetchNotifications(
  notificationStore: NotificationStore,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  try {
    const data = await gqlMutate(NOTIFICATIONS_WITH_COUNT_QUERY, { limit: PAGE_LIMIT });
    if (!isCancelled()) {
      notificationStore.reconcile(
        (data.notifications as DBNotification[] | null) ?? [],
        PAGE_LIMIT,
        typeof data.notificationUnreadCount === 'number' ? data.notificationUnreadCount : undefined,
      );
      notificationStore.setLoadState('loaded');
    }
  } catch {
    if (!isCancelled() && notificationStore.loadState !== 'loaded') {
      notificationStore.setLoadState('error');
    }
  }
}

/** "Load more": the page older than everything the inbox already holds. */
export async function fetchOlderNotifications(notificationStore: NotificationStore): Promise<void> {
  const before = notificationStore.oldestActiveCreatedAt;
  const data = await gqlMutate(NOTIFICATIONS_PAGE_QUERY, { before, limit: PAGE_LIMIT });
  notificationStore.appendPage((data.notifications as DBNotification[] | null) ?? [], PAGE_LIMIT);
}

/** The Snoozed view: rows the default list hides until they wake. */
export async function fetchSnoozedNotifications(
  notificationStore: NotificationStore,
): Promise<void> {
  const data = await gqlMutate(NOTIFICATIONS_PAGE_QUERY, { limit: 200, snoozed: true });
  notificationStore.upsertMany((data.notifications as DBNotification[] | null) ?? []);
}

export function useNotificationSync(): void {
  const { notificationStore } = useStore();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchNotifications(notificationStore, () => cancelled);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };
    load();
    const timer = setInterval(onVisible, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [notificationStore]);
}
