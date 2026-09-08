'use client';

import { Bell, Check, CheckCheck, Clock, MessageSquare, RefreshCw, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionHeader } from '@/components/shared/section-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
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
  workspace: string;
}

/**
 * One inbox row.
 *
 * It used to render the notification's *type* ("New comment") and a relative
 * timestamp — and nothing else. Both `actorId` and `issueId` were already
 * fetched and simply unused, so the inbox could tell you that something had
 * happened without telling you who did it or what to. The row is now a link to
 * the issue, titled with the issue itself and attributed to the actor.
 */
const NotificationItem = observer(function NotificationItem({
  notification,
  onMarkRead,
  onSnooze,
  markingId,
  snoozingId,
  workspace,
}: NotificationItemProps) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const { issueStore, userStore } = useStore();
  const { type, read, createdAt, id, actorId, issueId } = notification;
  const isMarkingThis = markingId === id;
  const isSnoozingThis = snoozingId === id;
  const actor = actorId ? userStore.findById(actorId) : null;
  const issue = issueId ? issueStore.findById(issueId) : null;

  return (
    <div
      className={cn(
        'group flex items-start gap-3 border-b border-border px-4 py-3 transition-colors',
        read
          ? 'hover:bg-accent/50'
          : 'bg-brand-subtle/40 hover:bg-brand-subtle dark:bg-brand-subtle',
      )}
    >
      {/* Unread marker in its own reserved slot, so read and unread rows keep
          the same text alignment down the list. */}
      <span className="mt-2 flex h-2 w-2 shrink-0 items-center justify-center">
        {!read && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>

      <div
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          read ? 'bg-muted text-muted-foreground' : 'bg-brand-subtle text-brand',
        )}
      >
        {getNotificationIcon(type)}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {actor
            ? t('notifications.actorDidThing', {
                action: t(getNotificationLabelKey(type)).toLowerCase(),
                name: actor.displayName,
              })
            : t(getNotificationLabelKey(type))}
        </p>
        {issue ? (
          <Link
            className="mt-0.5 flex min-w-0 items-baseline gap-2 text-sm hover:underline"
            href={`/${workspace}/issue/${issue.id}`}
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {issue.identifier}
            </span>
            <span
              className={cn('truncate', read ? 'text-foreground-secondary' : 'text-foreground')}
            >
              {issue.title}
            </span>
          </Link>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">{formatRelativeTime(createdAt)}</p>
      </div>

      {/* Revealed on hover at pointer sizes, always present on touch — the row
          is a link, so permanently-visible per-row buttons competed with it. */}
      {!read && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
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
});

// ─── Main component ───────────────────────────────────────────────────────────

/** Which slice of the inbox the list is showing. */
type InboxTab = 'all' | 'unread';

export const NotificationInbox = observer(function NotificationInbox() {
  const store = useStore();
  const { notificationStore } = store;
  const t = useTranslations();
  const { workspace } = useParams<{ workspace: string }>();

  const [tab, setTab] = useState<InboxTab>('all');
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

  const active = notifications.filter(n => !isSnoozed(n));
  const unread = active.filter(n => !n.read);
  const read = active.filter(n => n.read);
  const hasUnread = unread.length > 0;
  const visible = tab === 'unread' ? unread : active;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* PageHeader, not a centred `<h1>` with a bell beside it: the inbox was
          the one workspace route that did not look like the rest of the app. */}
      <PageHeader
        actions={
          hasUnread && (
            <Button disabled={markingAll} onClick={handleMarkAllRead} size="sm" variant="secondary">
              <CheckCheck className="h-3.5 w-3.5" />
              {markingAll ? t('notifications.marking') : t('notifications.markAllRead')}
            </Button>
          )
        }
        count={unread.length}
        title={t('notifications.title')}
      />

      <Toolbar>
        <SegmentedControl
          onChange={setTab}
          options={[
            { label: t('notifications.tabs.all'), value: 'all' },
            { label: t('notifications.tabs.unread'), value: 'unread' },
          ]}
          value={tab}
        />
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-brand" />
          </div>
        )}

        {/* Load failure — never render the empty state for a rejected read */}
        {!loading && loadError && (
          <InlineRetry message={t('notifications.toasts.loadFailed')} onRetry={retryLoad} />
        )}

        {!loading && !loadError && visible.length === 0 && (
          <EmptyState
            description={
              tab === 'unread'
                ? t('notifications.emptyState.unreadDetail')
                : t('notifications.emptyState.detail')
            }
            icon={<Bell className="h-5 w-5" />}
            testId="empty-state"
            title={
              tab === 'unread'
                ? t('notifications.emptyState.unreadTitle')
                : t('notifications.emptyState.title')
            }
          />
        )}

        {!loading &&
          (tab === 'unread' ? (
            <NotificationGroup
              markingId={markingId}
              notifications={unread}
              onMarkRead={handleMarkRead}
              onSnooze={handleSnooze}
              snoozingId={snoozingId}
              title={t('notifications.unreadCount', { count: unread.length })}
              workspace={workspace}
            />
          ) : (
            <>
              {unread.length > 0 && (
                <NotificationGroup
                  markingId={markingId}
                  notifications={unread}
                  onMarkRead={handleMarkRead}
                  onSnooze={handleSnooze}
                  snoozingId={snoozingId}
                  title={t('notifications.unreadCount', { count: unread.length })}
                  workspace={workspace}
                />
              )}
              {read.length > 0 && (
                <NotificationGroup
                  markingId={markingId}
                  notifications={read}
                  onMarkRead={handleMarkRead}
                  onSnooze={handleSnooze}
                  snoozingId={snoozingId}
                  title={hasUnread ? t('notifications.read') : t('notifications.allNotifications')}
                  workspace={workspace}
                />
              )}
            </>
          ))}
      </div>
    </div>
  );
});

/** Unread / read grouping, with the shared uppercase section header. */
function NotificationGroup({
  markingId,
  notifications,
  onMarkRead,
  onSnooze,
  snoozingId,
  title,
  workspace,
}: {
  markingId: string | null;
  notifications: DBNotification[];
  onMarkRead: (id: string) => void;
  onSnooze: (id: string, until: Date) => void;
  snoozingId: string | null;
  title: string;
  workspace: string;
}) {
  if (notifications.length === 0) {
    return null;
  }
  return (
    <section>
      <div className="border-b border-border bg-surface-sunken px-4 py-1.5">
        <SectionHeader as="h2" title={title} />
      </div>
      {notifications.map(notification => (
        <NotificationItem
          key={notification.id}
          markingId={markingId}
          notification={notification}
          onMarkRead={onMarkRead}
          onSnooze={onSnooze}
          snoozingId={snoozingId}
          workspace={workspace}
        />
      ))}
    </section>
  );
}
