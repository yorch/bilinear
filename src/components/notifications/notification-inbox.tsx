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
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationActor {
  id: string;
  displayName: string;
  initials: string;
  avatarBgColor: string | null;
}

interface NotificationIssue {
  id: string;
  identifier: string;
  title: string;
}

interface Notification {
  id: string;
  type: string;
  read: boolean;
  readAt: string | null;
  snoozedUntilAt: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  actor: NotificationActor | null;
  issue: NotificationIssue | null;
}

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
      actor {
        id
        displayName
        initials
        avatarBgColor
      }
      issue {
        id
        identifier
        title
      }
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 1) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return 'yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w ago`;
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

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
  notification: Notification;
  onMarkRead: (id: string) => void;
  markingId: string | null;
}

function NotificationItem({
  notification,
  onMarkRead,
  markingId,
}: NotificationItemProps) {
  const { actor, issue, type, read, createdAt, id } = notification;
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
          {actor && (
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                !actor.avatarBgColor && 'bg-indigo-500',
              )}
              style={
                actor.avatarBgColor
                  ? { backgroundColor: actor.avatarBgColor }
                  : undefined
              }
              title={actor.displayName}
            >
              {actor.initials}
            </span>
          )}
          <span
            className={cn(
              'font-medium',
              read
                ? 'text-zinc-600 dark:text-zinc-400'
                : 'text-zinc-900 dark:text-zinc-100',
            )}
          >
            {actor?.displayName ?? 'System'}
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {getNotificationLabel(type)}
          </span>
        </div>

        {issue && (
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-mono">{issue.identifier}</span>{' '}
            <span>{issue.title}</span>
          </p>
        )}

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _store = useStore(); // ensure store context is available

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchNotifications = async () => {
      setLoading(true);
      try {
        const res = await gql(GET_NOTIFICATIONS_QUERY, { limit: 50 });
        if (!cancelled) {
          const data = res.data as
            | { notifications?: Notification[] }
            | undefined;
          setNotifications(data?.notifications ?? []);
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load notifications');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMarkRead = async (id: string) => {
    setMarkingId(id);
    try {
      const res = await gql(MARK_READ_MUTATION, { id });
      if (res.errors?.length) {
        throw new Error('Failed to mark notification as read');
      }
      setNotifications(prev =>
        prev.map(n =>
          n.id === id
            ? { ...n, read: true, readAt: new Date().toISOString() }
            : n,
        ),
      );
    } catch {
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
      const now = new Date().toISOString();
      setNotifications(prev =>
        prev.map(n => ({ ...n, read: true, readAt: n.readAt ?? now })),
      );
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
