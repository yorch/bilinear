'use client';

import {
  Bell,
  Check,
  CheckCheck,
  MessageSquare,
  RefreshCw,
  User,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { DBNotification } from '@/lib/db';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_NOTIFICATIONS_QUERY = `
  query GetNotifications($limit: Int) {
    notifications(limit: $limit) {
      id
      type
      read
      readAt
      snoozedUntilAt
      data
      createdAt
      userId
      actorId
      issueId
      organizationId
      updatedAt
    }
  }
`;

const MARK_READ_MUTATION = `
  mutation NotificationMarkRead($id: ID!) {
    notificationMarkRead(id: $id) {
      success
      lastSyncId
    }
  }
`;

const MARK_ALL_READ_MUTATION = `
  mutation NotificationMarkAllRead {
    notificationMarkAllRead {
      success
      lastSyncId
    }
  }
`;

function getNotificationIcon(type: string) {
  switch (type) {
    case 'ISSUE_ASSIGNED':
      return <User className="h-3.5 w-3.5" />;
    case 'ISSUE_MENTIONED':
    case 'ISSUE_COMMENTED':
      return <MessageSquare className="h-3.5 w-3.5" />;
    case 'ISSUE_STATUS_CHANGED':
      return <RefreshCw className="h-3.5 w-3.5" />;
    default:
      return <Bell className="h-3.5 w-3.5" />;
  }
}

function getNotificationLabel(type: string): string {
  switch (type) {
    case 'ISSUE_ASSIGNED':
      return 'assigned you to an issue';
    case 'ISSUE_MENTIONED':
      return 'mentioned you in an issue';
    case 'ISSUE_COMMENTED':
      return 'commented on an issue';
    case 'ISSUE_STATUS_CHANGED':
      return 'changed the status of an issue';
    default:
      return 'sent a notification';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface NotificationItemProps {
  notification: DBNotification;
  onMarkRead: (id: string) => void;
  markingId: string | null;
}

function NotificationItem({
  notification,
  onMarkRead,
  markingId,
}: NotificationItemProps) {
  const { type, read, createdAt, id } = notification;
  const isMarkingThis = markingId === id;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
        read
          ? 'border-zinc-100 dark:border-zinc-800'
          : 'border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/40 dark:bg-indigo-950/20',
      )}
    >
      {/* Type icon */}
      <div
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          read
            ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
            : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400',
        )}
      >
        {getNotificationIcon(type)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1 text-sm">
          <span
            className={cn(
              'font-medium',
              read
                ? 'text-zinc-600 dark:text-zinc-400'
                : 'text-zinc-900 dark:text-zinc-100',
            )}
          >
            {getNotificationLabel(type)}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
          {formatRelativeTime(createdAt)}
        </p>
      </div>

      {/* Mark read button */}
      {!read && (
        <button
          type="button"
          onClick={() => onMarkRead(id)}
          disabled={isMarkingThis}
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-indigo-400 disabled:opacity-50"
          title="Mark as read"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const NotificationInbox = observer(function NotificationInbox() {
  const store = useStore();
  const { notificationStore } = store;

  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Initial fetch — populate the store; subsequent updates arrive via WebSocket
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    gql(GET_NOTIFICATIONS_QUERY, { limit: 50 })
      .then(res => {
        if (cancelled) {
          return;
        }
        const data =
          (res.data as { notifications?: DBNotification[] } | undefined)
            ?.notifications ?? [];
        notificationStore.upsertMany(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Failed to load notifications');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [notificationStore]);

  // Reactive — re-renders when the store is updated (e.g. via WS sync actions)
  const notifications = notificationStore.all;

  const handleMarkRead = async (id: string) => {
    notificationStore.markRead(id); // Optimistic update
    setMarkingId(id);
    try {
      const res = await gql(MARK_READ_MUTATION, { id });
      if (res.errors?.length) {
        throw new Error('Failed to mark notification as read');
      }
    } catch {
      // Roll back optimistic update
      notificationStore.optimisticUpdate(id, {
        read: false,
        readAt: undefined,
      });
      toast.error('Failed to mark notification as read');
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await gql(MARK_ALL_READ_MUTATION, {});
      if (res.errors?.length) {
        throw new Error('Failed to mark all notifications as read');
      }
      notificationStore.markAllRead();
    } catch {
      toast.error('Failed to mark all notifications as read');
    } finally {
      setMarkingAll(false);
    }
  };

  const unread = notifications.filter(n => !n.read);
  const read = notifications.filter(n => n.read);
  const hasUnread = unread.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-zinc-500" />
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Inbox
          </h1>
          {hasUnread && (
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
              {unread.length}
            </span>
          )}
        </div>

        {hasUnread && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && notifications.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <Bell className="h-6 w-6 text-zinc-400" />
          </div>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            All caught up
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            No notifications yet. You'll be notified when something needs your
            attention.
          </p>
        </div>
      )}

      {/* Unread section */}
      {!loading && unread.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Unread ({unread.length})
          </h2>
          <div className="flex flex-col gap-2">
            {unread.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={handleMarkRead}
                markingId={markingId}
              />
            ))}
          </div>
        </section>
      )}

      {/* Read section */}
      {!loading && read.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {hasUnread ? 'Read' : 'All notifications'}
          </h2>
          <div className="flex flex-col gap-2">
            {read.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={handleMarkRead}
                markingId={markingId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
});
