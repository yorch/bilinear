'use client';

import {
  AlarmClock,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  Mail,
  MessageSquare,
  RefreshCw,
  User,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type InboxLane,
  partitionByLane,
  readStoredLane,
  reminderTime,
  writeStoredLane,
} from '@/components/notifications/notification-priority';
import {
  NOTIFICATION_MARK_UNREAD_MUTATION,
  NOTIFICATION_UNSNOOZE_MUTATION,
} from '@/components/notifications/notification-queries';
import { resolveNotificationTarget } from '@/components/notifications/notification-target';
import {
  fetchNotifications,
  fetchOlderNotifications,
  fetchSnoozedNotifications,
} from '@/components/notifications/use-notification-sync';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionHeader } from '@/components/shared/section-header';
import { TabSwitcher, tabPanelProps } from '@/components/shared/tab-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { SelectPopover } from '@/components/ui/select-popover';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import type { DBNotification } from '@/lib/db';
import { gql, gqlMutate } from '@/lib/graphql';
import {
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
    case 'REMINDER':
      return <AlarmClock className="h-3.5 w-3.5" />;
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
    case 'REMINDER':
      return 'notifications.labels.reminder';
    default:
      return 'notifications.labels.default';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface NotificationItemProps {
  markingId: string | null;
  notification: DBNotification;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onSnooze: (id: string, until: Date) => void;
  onUnsnooze: (id: string) => void;
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
  onMarkUnread,
  onSnooze,
  onUnsnooze,
  markingId,
  snoozingId,
  workspace,
}: NotificationItemProps) {
  const t = useTranslations();
  const { formatDateTime, formatRelativeTime } = useFormatters();
  const { documentStore, initiativeStore, issueStore, projectStore, userStore } = useStore();
  const { type, read, createdAt, id, actorId } = notification;
  const isMarkingThis = markingId === id;
  const isSnoozingThis = snoozingId === id;
  const actor = actorId ? userStore.findById(actorId) : null;
  const snoozed = isSnoozed(notification);
  const isReminder = type === 'REMINDER';
  const remindAt = isReminder ? reminderTime(notification) : null;
  const dataIssueId = (notification.data as { issueId?: unknown } | null)?.issueId;
  const target = resolveNotificationTarget(
    {
      data: notification.data,
      issueId: notification.issueId ?? (typeof dataIssueId === 'string' ? dataIssueId : null),
    },
    workspace,
    {
      document: docId => documentStore.findById(docId),
      initiative: initId => initiativeStore.findById(initId),
      issue: issueId => issueStore.findById(issueId),
      project: projectId => projectStore.findById(projectId),
    },
  );

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
          {actor && !isReminder
            ? t('notifications.actorDidThing', {
                action: t(getNotificationLabelKey(type)).toLowerCase(),
                name: actor.displayName,
              })
            : t(getNotificationLabelKey(type))}
        </p>
        {target ? (
          <Link
            className="mt-0.5 flex min-w-0 items-baseline gap-2 text-sm hover:underline"
            href={target.href}
            // Following the notification is reading it. Without this the row
            // stayed unread after the user had opened the issue, and they had
            // to come back and press the check.
            onClick={() => {
              if (!read) {
                onMarkRead(id);
              }
            }}
          >
            {target.identifier ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {target.identifier}
              </span>
            ) : null}
            <span
              className={cn('truncate', read ? 'text-foreground-secondary' : 'text-foreground')}
            >
              {isReminder
                ? t('notifications.reminderTitle', { title: target.title })
                : target.title || t('notifications.openLink')}
            </span>
          </Link>
        ) : null}
        {remindAt ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('notifications.remindedFor', {
              when: formatDateTime(remindAt, { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </p>
        ) : null}
        {snoozed ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('notifications.snoozedUntil', {
              // Absolute: the relative formatter only speaks about the past.
              when: formatDateTime(notification.snoozedUntilAt ?? createdAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">{formatRelativeTime(createdAt)}</p>
      </div>

      {/* Revealed on hover at pointer sizes, always present on touch — the row
          is a link, so permanently-visible per-row buttons competed with it. */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        {snoozed ? (
          <button
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand disabled:opacity-50',
              TOUCH_TARGET,
            )}
            disabled={isSnoozingThis}
            onClick={() => onUnsnooze(id)}
            title={t('notifications.unsnooze')}
            type="button"
          >
            <BellOff className="h-3.5 w-3.5" />
          </button>
        ) : (
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
        )}

        {read ? (
          <button
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand disabled:opacity-50',
              TOUCH_TARGET,
            )}
            disabled={isMarkingThis}
            onClick={() => onMarkUnread(id)}
            title={t('notifications.markAsUnread')}
            type="button"
          >
            <Mail className="h-3.5 w-3.5" />
          </button>
        ) : (
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
        )}
      </div>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

/** Which slice of the inbox the list is showing. */
type InboxTab = 'all' | 'snoozed' | 'unread';

export const NotificationInbox = observer(function NotificationInbox() {
  const store = useStore();
  const { notificationStore } = store;
  const t = useTranslations();
  const { workspace } = useParams<{ workspace: string }>();

  const [tab, setTab] = useState<InboxTab>('all');
  // Priority vs Other. Starts on Priority (SSR-safe) and adopts the last-used
  // lane once mounted, so the hydration markup never depends on storage.
  const [lane, setLaneState] = useState<InboxLane>('priority');
  const viewerId = store.userStore.currentUserId;
  useEffect(() => {
    const stored = readStoredLane(viewerId);
    if (stored) {
      setLaneState(stored);
    }
  }, [viewerId]);
  const setLane = (next: InboxLane) => {
    setLaneState(next);
    writeStoredLane(next, viewerId);
  };
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [snoozedLoadFailed, setSnoozedLoadFailed] = useState(false);

  // Snoozed rows are hidden from the default list server-side, so the tab
  // fetches them when it opens (and the store keeps them across refreshes).
  useEffect(() => {
    if (tab !== 'snoozed') {
      return;
    }
    setSnoozedLoadFailed(false);
    fetchSnoozedNotifications(notificationStore).catch(() => setSnoozedLoadFailed(true));
  }, [tab, notificationStore]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchOlderNotifications(notificationStore);
    } catch {
      toast.error(t('notifications.toasts.loadFailed'));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleMarkUnread = async (id: string) => {
    const prev = notificationStore.findById(id);
    const prevReadAt = prev?.readAt ?? null;
    notificationStore.markUnread(id);
    setMarkingId(id);
    try {
      await gqlMutate(NOTIFICATION_MARK_UNREAD_MUTATION, { id });
    } catch {
      notificationStore.optimisticUpdate(id, { read: true, readAt: prevReadAt });
      toast.error(t('notifications.toasts.markUnreadFailed'));
    } finally {
      setMarkingId(null);
    }
  };

  const handleUnsnooze = async (id: string) => {
    const prevSnoozedUntilAt = notificationStore.findById(id)?.snoozedUntilAt ?? null;
    notificationStore.optimisticUpdate(id, { snoozedUntilAt: null });
    setSnoozingId(id);
    try {
      await gqlMutate(NOTIFICATION_UNSNOOZE_MUTATION, { id });
      toast.success(t('notifications.toasts.unsnoozed'));
    } catch {
      notificationStore.optimisticUpdate(id, { snoozedUntilAt: prevSnoozedUntilAt });
      toast.error(t('notifications.toasts.unsnoozeFailed'));
    } finally {
      setSnoozingId(null);
    }
  };

  // The shell's `useNotificationSync` already fetches on mount, on focus and
  // every minute, so the Inbox only reads the store (a second fetch here just
  // doubled the request on every visit). New notifications do NOT arrive over
  // WebSocket: a notification belongs to one recipient and SyncActions
  // broadcast org-wide. A rejected first read must not render "You're all
  // caught up" while assigned issues and @mentions are silently invisible.
  const loading = notificationStore.loadState === 'idle';
  const loadError = notificationStore.loadState === 'error';
  const retryLoad = () => {
    notificationStore.setLoadState('idle');
    void fetchNotifications(notificationStore).then(() => {
      if (notificationStore.loadState === 'error') {
        toast.error(t('notifications.toasts.loadFailed'));
      }
    });
  };

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

  const priorityLookups = {
    issueAssigneeId: (issueId: string) => store.issueStore.findById(issueId)?.assigneeId ?? null,
  };
  const laneOf = (rows: DBNotification[]) => partitionByLane(rows, viewerId, priorityLookups);
  const allActive = notifications.filter(n => !isSnoozed(n));
  const activeByLane = laneOf(allActive);
  const pooledLaneUnread = {
    other: activeByLane.other.filter(n => !n.read).length,
    priority: activeByLane.priority.filter(n => !n.read).length,
  };
  // The server's per-lane totals are exact. Only before they arrive (or against
  // an older server) do the counts fall back to the loaded page — a lower bound
  // while more pages exist, and then they say so.
  const serverLane = {
    other: notificationStore.laneUnreadCount('other'),
    priority: notificationStore.laneUnreadCount('priority'),
  };
  const laneUnread = {
    other: serverLane.other ?? pooledLaneUnread.other,
    priority: serverLane.priority ?? pooledLaneUnread.priority,
  };
  const laneSuffix = serverLane.priority === null && notificationStore.hasMore ? '+' : '';
  const active = activeByLane[lane];
  const unread = active.filter(n => !n.read);
  const read = active.filter(n => n.read);
  // The badge is the server's own total (kept exact by `unreadCount`), not the
  // size of the fetched page — which read "7 unread" against 29 in the database.
  const unreadLabel = notificationStore.unreadCount;
  const hasUnread = unreadLabel > 0;
  const snoozedRows = laneOf(notificationStore.snoozed)[lane];
  const visible = tab === 'unread' ? unread : tab === 'snoozed' ? snoozedRows : active;

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
        // The badge here means "unread", not "rows listed" like every other
        // page, so it is brand-toned and labelled, and absent at zero.
        title={
          <>
            {t('notifications.title')}
            {hasUnread && (
              <Badge className="ml-2 align-middle font-mono tabular-nums" tone="brand">
                {t('notifications.unreadBadge', { count: unreadLabel })}
              </Badge>
            )}
          </>
        }
      />

      <Toolbar>
        <TabSwitcher
          ariaLabel={t('notifications.lanes.label')}
          idPrefix="inbox-lane"
          onChange={setLane}
          options={[
            {
              label: (
                <>
                  {t('notifications.lanes.priority')}
                  <span className="font-mono tabular-nums" data-testid="lane-count-priority">
                    {laneUnread.priority}
                    {laneSuffix}
                  </span>
                </>
              ),
              value: 'priority',
            },
            {
              label: (
                <>
                  {t('notifications.lanes.other')}
                  <span className="font-mono tabular-nums" data-testid="lane-count-other">
                    {laneUnread.other}
                    {laneSuffix}
                  </span>
                </>
              ),
              value: 'other',
            },
          ]}
          panelId="inbox-tab-panel"
          value={lane}
        />
        <TabSwitcher
          ariaLabel={t('notifications.tabs.label')}
          idPrefix="inbox-tab"
          onChange={setTab}
          options={[
            { label: t('notifications.tabs.all'), value: 'all' },
            { label: t('notifications.tabs.unread'), value: 'unread' },
            { label: t('notifications.tabs.snoozed'), value: 'snoozed' },
          ]}
          value={tab}
        />
      </Toolbar>

      <div {...tabPanelProps('inbox-tab', tab)} className="min-h-0 flex-1 overflow-y-auto">
        {loading && <RowsSkeleton className="px-4 py-4" count={6} />}

        {/* Load failure — never render the empty state for a rejected read */}
        {!loading && loadError && (
          <InlineRetry message={t('notifications.toasts.loadFailed')} onRetry={retryLoad} />
        )}

        {tab === 'snoozed' && snoozedLoadFailed && (
          <InlineRetry
            message={t('notifications.toasts.loadFailed')}
            onRetry={() => {
              setSnoozedLoadFailed(false);
              fetchSnoozedNotifications(notificationStore).catch(() => setSnoozedLoadFailed(true));
            }}
          />
        )}

        {!loading && !loadError && visible.length === 0 && (
          <EmptyState
            description={
              tab === 'snoozed'
                ? t('notifications.emptyState.snoozedDetail')
                : tab === 'unread'
                  ? t('notifications.emptyState.unreadDetail')
                  : lane === 'priority'
                    ? t('notifications.emptyState.priorityDetail')
                    : t('notifications.emptyState.otherDetail')
            }
            icon={<Bell className="h-5 w-5" />}
            testId="empty-state"
            title={
              tab === 'snoozed'
                ? t('notifications.emptyState.snoozedTitle')
                : tab === 'unread'
                  ? t('notifications.emptyState.unreadTitle')
                  : lane === 'priority'
                    ? t('notifications.emptyState.priorityTitle')
                    : t('notifications.emptyState.otherTitle')
            }
          />
        )}

        {!loading &&
          (tab === 'snoozed' ? (
            <NotificationGroup
              markingId={markingId}
              notifications={snoozedRows}
              onMarkRead={handleMarkRead}
              onMarkUnread={handleMarkUnread}
              onSnooze={handleSnooze}
              onUnsnooze={handleUnsnooze}
              snoozingId={snoozingId}
              title={t('notifications.snoozedCount', { count: snoozedRows.length })}
              workspace={workspace}
            />
          ) : tab === 'unread' ? (
            <NotificationGroup
              markingId={markingId}
              notifications={unread}
              onMarkRead={handleMarkRead}
              onMarkUnread={handleMarkUnread}
              onSnooze={handleSnooze}
              onUnsnooze={handleUnsnooze}
              snoozingId={snoozingId}
              title={t('notifications.unreadCount', { count: laneUnread[lane] })}
              workspace={workspace}
            />
          ) : (
            <>
              {unread.length > 0 && (
                <NotificationGroup
                  markingId={markingId}
                  notifications={unread}
                  onMarkRead={handleMarkRead}
                  onMarkUnread={handleMarkUnread}
                  onSnooze={handleSnooze}
                  onUnsnooze={handleUnsnooze}
                  snoozingId={snoozingId}
                  title={t('notifications.unreadCount', { count: laneUnread[lane] })}
                  workspace={workspace}
                />
              )}
              {read.length > 0 && (
                <NotificationGroup
                  markingId={markingId}
                  notifications={read}
                  onMarkRead={handleMarkRead}
                  onMarkUnread={handleMarkUnread}
                  onSnooze={handleSnooze}
                  onUnsnooze={handleUnsnooze}
                  snoozingId={snoozingId}
                  title={hasUnread ? t('notifications.read') : t('notifications.allNotifications')}
                  workspace={workspace}
                />
              )}
            </>
          ))}

        {!loading && tab !== 'snoozed' && notificationStore.hasMore && (
          <div className="flex justify-center px-4 py-4">
            <Button
              disabled={loadingMore}
              onClick={() => void handleLoadMore()}
              size="sm"
              variant="outline"
            >
              {loadingMore ? t('common.loading') : t('notifications.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

/** Unread / read grouping, with the shared uppercase section header. */
function NotificationGroup({
  markingId,
  notifications,
  onMarkRead,
  onMarkUnread,
  onSnooze,
  onUnsnooze,
  snoozingId,
  title,
  workspace,
}: {
  markingId: string | null;
  notifications: DBNotification[];
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onSnooze: (id: string, until: Date) => void;
  onUnsnooze: (id: string) => void;
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
          onMarkUnread={onMarkUnread}
          onSnooze={onSnooze}
          onUnsnooze={onUnsnooze}
          snoozingId={snoozingId}
          workspace={workspace}
        />
      ))}
    </section>
  );
}
