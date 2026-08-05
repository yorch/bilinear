'use client';

import { Bell, Check, CheckCheck, Clock, MessageSquare, RefreshCw, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectPopover } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import type { DBNotification } from '@/lib/db';
import { gql, gqlQuery } from '@/lib/graphql';
import {
  GET_NOTIFICATIONS_QUERY,
  NOTIFICATION_MARK_ALL_READ_MUTATION,
  NOTIFICATION_MARK_READ_MUTATION,
  NOTIFICATION_SNOOZE_MUTATION,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ─── Snooze helpers ───────────────────────────────────────────────────────────

interface SnoozePreset {
  getUntil: () => Date;
  labelKey: string;
}

const SNOOZE_PRESETS: SnoozePreset[] = [
  {
    getUntil: () => new Date(Date.now() + 60 * 60 * 1000),
    labelKey: 'notifications.snooze.oneHour',
  },
  {
    getUntil: () => new Date(Date.now() + 4 * 60 * 60 * 1000),
    labelKey: 'notifications.snooze.fourHours',
  },
  {
    getUntil: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
    labelKey: 'notifications.snooze.tomorrow9am',
  },
  {
    getUntil: () => {
      const d = new Date();
      // Move to next Monday
      const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
      const daysUntilMonday = day === 0 ? 1 : 8 - day;
      d.setDate(d.getDate() + daysUntilMonday);
      d.setHours(9, 0, 0, 0);
      return d;
    },
    labelKey: 'notifications.snooze.nextWeek',
  },
];

function isSnoozed(n: { snoozedUntilAt?: string | null }): boolean {
  if (!n.snoozedUntilAt) {
    return false;
  }
  return new Date(n.snoozedUntilAt) > new Date();
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

function getNotificationLabelKey(type: string): string {
  switch (type) {
    case 'ISSUE_ASSIGNED':
      return 'notifications.labels.issueAssigned';
    case 'ISSUE_MENTIONED':
      return 'notifications.labels.issueMentioned';
    case 'ISSUE_COMMENTED':
      return 'notifications.labels.issueCommented';
    case 'ISSUE_STATUS_CHANGED':
      return 'notifications.labels.issueStatusChanged';
    default:
      return 'notifications.labels.default';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface NotificationItemProps {
  markingId: string | null;
  notification: DBNotification;
  onMarkRead: (id: string) => void;
  onSnooze: (id: string, until: Date) => void;
  snoozingId: string | null;
}

function NotificationItem({
  notification,
  onMarkRead,
  onSnooze,
  markingId,
  snoozingId,
}: NotificationItemProps) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const { type, read, createdAt, id } = notification;
  const isMarkingThis = markingId === id;
  const isSnoozingThis = snoozingId === id;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
        read ? 'border-border' : 'border-brand-border bg-brand-subtle/40 dark:bg-brand-subtle',
      )}
    >
      {/* Type icon */}
      <div
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          read ? 'bg-muted text-muted-foreground' : 'bg-brand-subtle text-brand',
        )}
      >
        {getNotificationIcon(type)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1 text-sm">
          <span className={cn('font-medium', read ? 'text-muted-foreground' : 'text-foreground')}>
            {t(getNotificationLabelKey(type))}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground">{formatRelativeTime(createdAt)}</p>
      </div>

      {/* Action buttons (unread only) */}
      {!read && (
        <div className="flex shrink-0 items-center gap-1">
          {/* Snooze button with dropdown */}
          <SelectPopover
            align="right"
            disabled={isSnoozingThis}
            panelClassName="w-44 py-1 shadow-e3"
            triggerChildren={<Clock className="h-3.5 w-3.5" />}
            triggerClassName={cn(
              'p-1 text-muted-foreground hover:text-foreground-secondary',
              TOUCH_TARGET,
            )}
            triggerTitle={t('notifications.snooze.buttonTitle')}
          >
            {close => (
              <>
                {SNOOZE_PRESETS.map(preset => (
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-foreground-secondary hover:bg-accent"
                    key={preset.labelKey}
                    onClick={() => {
                      close();
                      onSnooze(id, preset.getUntil());
                    }}
                    type="button"
                  >
                    {t(preset.labelKey)}
                  </button>
                ))}
              </>
            )}
          </SelectPopover>

          {/* Mark read button */}
          <button
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand disabled:opacity-50',
              TOUCH_TARGET,
            )}
            disabled={isMarkingThis}
            onClick={() => onMarkRead(id)}
            title={t('notifications.markAsRead')}
            type="button"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const NotificationInbox = observer(function NotificationInbox() {
  const store = useStore();
  const { notificationStore } = store;
  const t = useTranslations();

  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);

  // Fetch on mount and whenever the inbox reopens. Note that new notifications
  // do NOT arrive over WebSocket: `NotificationService` emits no 'I' SyncAction,
  // and it deliberately shouldn't while SyncActions broadcast org-wide — a
  // notification belongs to one recipient. Live delivery needs a per-user
  // channel; until then this fetch is the only path.
  //
  // Rows land in the MobX store, not in the hook's `data` — the list below is
  // read reactively from the store. A rejected read must not render the
  // "You're all caught up" empty state while assigned issues and @mentions
  // are silently invisible.
  const {
    error: loadError,
    loading,
    refetch: retryLoad,
  } = useRetryableFetch<DBNotification[]>(
    async () => {
      try {
        const data = await gqlQuery<DBNotification[] | null>(
          GET_NOTIFICATIONS_QUERY,
          { limit: 50 },
          'notifications',
        );
        notificationStore.upsertMany(data ?? []);
        return data ?? [];
      } catch (err) {
        toast.error(t('notifications.toasts.loadFailed'));
        throw err;
      }
    },
    [notificationStore, t],
    [],
  );

  // Reactive — re-renders when the store is updated (e.g. via WS sync actions)
  const notifications = notificationStore.all;

  const handleMarkRead = async (id: string) => {
    // Snapshot the pre-mutation values so a rollback restores the exact
    // prior state. The previous implementation rolled back to
    // `readAt: undefined`, which would clobber a non-null readAt if the
    // notification had been read-then-unread-then-read-again.
    const prev = notificationStore.findById(id);
    const prevRead = prev?.read ?? false;
    const prevReadAt = prev?.readAt ?? null;
    notificationStore.markRead(id); // Optimistic update
    setMarkingId(id);
    try {
      const res = await gql(NOTIFICATION_MARK_READ_MUTATION, { id });
      if (res.errors?.length) {
        throw new Error(t('notifications.toasts.markReadFailed'));
      }
    } catch {
      notificationStore.optimisticUpdate(id, {
        read: prevRead,
        readAt: prevReadAt,
      });
      toast.error(t('notifications.toasts.markReadFailed'));
    } finally {
      setMarkingId(null);
    }
  };

  const handleSnooze = async (id: string, until: Date) => {
    // Snapshot the prior snooze (could be a real future date if the user
    // is extending an existing snooze) so a rollback restores the exact
    // prior state instead of clobbering it to null.
    const prev = notificationStore.findById(id);
    const prevSnoozedUntilAt = prev?.snoozedUntilAt ?? null;
    notificationStore.optimisticUpdate(id, {
      snoozedUntilAt: until.toISOString(),
    });
    setSnoozingId(id);
    try {
      const res = await gql(NOTIFICATION_SNOOZE_MUTATION, {
        id,
        until: until.toISOString(),
      });
      if (res.errors?.length) {
        throw new Error(t('notifications.toasts.snoozeFailed'));
      }
      toast.success(t('notifications.toasts.snoozed'));
    } catch {
      notificationStore.optimisticUpdate(id, { snoozedUntilAt: prevSnoozedUntilAt });
      toast.error(t('notifications.toasts.snoozeFailed'));
    } finally {
      setSnoozingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await gql(NOTIFICATION_MARK_ALL_READ_MUTATION, {});
      if (res.errors?.length) {
        throw new Error(t('notifications.toasts.markAllReadFailed'));
      }
      notificationStore.markAllRead();
    } catch {
      toast.error(t('notifications.toasts.markAllReadFailed'));
    } finally {
      setMarkingAll(false);
    }
  };

  const unread = notifications.filter(n => !n.read && !isSnoozed(n));
  const read = notifications.filter(n => n.read && !isSnoozed(n));
  const hasUnread = unread.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">{t('notifications.title')}</h1>
          {hasUnread && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              {unread.length}
            </span>
          )}
        </div>

        {hasUnread && (
          <button
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={markingAll}
            onClick={handleMarkAllRead}
            type="button"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {markingAll ? t('notifications.marking') : t('notifications.markAllRead')}
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-brand" />
        </div>
      )}

      {/* Load failure — never render the empty state for a rejected read */}
      {!loading && loadError && (
        <InlineRetry message={t('notifications.toasts.loadFailed')} onRetry={retryLoad} />
      )}

      {/* Empty state */}
      {!loading && !loadError && notifications.length === 0 && (
        <EmptyState
          description={t('notifications.emptyState.detail')}
          icon={<Bell className="h-5 w-5" />}
          title={t('notifications.emptyState.title')}
        />
      )}

      {/* Unread section */}
      {!loading && unread.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('notifications.unreadCount', { count: unread.length })}
          </h2>
          <div className="flex flex-col gap-2">
            {unread.map(notification => (
              <NotificationItem
                key={notification.id}
                markingId={markingId}
                notification={notification}
                onMarkRead={handleMarkRead}
                onSnooze={handleSnooze}
                snoozingId={snoozingId}
              />
            ))}
          </div>
        </section>
      )}

      {/* Read section */}
      {!loading && read.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {hasUnread ? t('notifications.read') : t('notifications.allNotifications')}
          </h2>
          <div className="flex flex-col gap-2">
            {read.map(notification => (
              <NotificationItem
                key={notification.id}
                markingId={markingId}
                notification={notification}
                onMarkRead={handleMarkRead}
                onSnooze={handleSnooze}
                snoozingId={snoozingId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
});
