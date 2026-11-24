import type { DBNotification } from '@/lib/db';

/** The two inbox lanes: direct signals to the viewer vs subscribed activity. */
export type InboxLane = 'other' | 'priority';

export const INBOX_LANES: readonly InboxLane[] = ['priority', 'other'];

/** What the classifier needs from the stores — injected so it stays pure. */
export interface PriorityLookups {
  /** The assignee of an issue, or null when unassigned / not in the store. */
  issueAssigneeId: (issueId: string) => string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Which lane a notification belongs to for `viewerId`.
 *
 * Priority is a direct signal: you were assigned, @mentioned, replied to, you
 * are reminded, or the status of an issue *you* are assigned changed. Everything
 * else (comments and status changes on issues you merely subscribe to) is Other.
 * Unknown types fall to Other so a new notification type is never promoted by
 * accident. A reply is recognised by any of `isReply`, `replyToUserId` or
 * `parentAuthorId` in the payload; a comment notification with none of them is
 * ordinary subscribed activity.
 */
export function classifyNotification(
  notification: Pick<DBNotification, 'data' | 'issueId' | 'type'>,
  viewerId: string | null,
  lookups: PriorityLookups,
): InboxLane {
  const data = (notification.data ?? {}) as Record<string, unknown>;
  switch (notification.type) {
    case 'ISSUE_ASSIGNED':
    case 'ISSUE_MENTIONED':
    case 'REMINDER':
      return 'priority';
    case 'ISSUE_COMMENTED': {
      if (!viewerId) {
        return 'other';
      }
      const repliedTo = str(data.replyToUserId) ?? str(data.parentAuthorId);
      return data.isReply === true || repliedTo === viewerId ? 'priority' : 'other';
    }
    case 'ISSUE_STATUS_CHANGED':
    case 'ISSUE_PRIORITY_CHANGED': {
      const issueId = notification.issueId ?? str(data.issueId);
      return viewerId && issueId && lookups.issueAssigneeId(issueId) === viewerId
        ? 'priority'
        : 'other';
    }
    default:
      return 'other';
  }
}

/** Split a list into lanes, preserving order. */
export function partitionByLane<T extends Pick<DBNotification, 'data' | 'issueId' | 'type'>>(
  notifications: T[],
  viewerId: string | null,
  lookups: PriorityLookups,
): Record<InboxLane, T[]> {
  const out: Record<InboxLane, T[]> = { other: [], priority: [] };
  for (const n of notifications) {
    out[classifyNotification(n, viewerId, lookups)].push(n);
  }
  return out;
}

/** Remind time carried by a REMINDER notification, or null when absent/invalid. */
export function reminderTime(notification: Pick<DBNotification, 'data'>): string | null {
  const raw = str((notification.data as Record<string, unknown> | null)?.remindAt);
  return raw && !Number.isNaN(new Date(raw).getTime()) ? raw : null;
}

const LANE_STORAGE_KEY = 'inbox.lane';

/** Last-used lane (a per-viewer convenience; null when storage is unavailable). */
export function readStoredLane(): InboxLane | null {
  try {
    const v = window.localStorage.getItem(LANE_STORAGE_KEY);
    return v === 'priority' || v === 'other' ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredLane(lane: InboxLane): void {
  try {
    window.localStorage.setItem(LANE_STORAGE_KEY, lane);
  } catch {
    // Storage blocked: the lane just won't be remembered.
  }
}

/** The lane one arrow-key step away, wrapping; null for non-navigation keys. */
export function nextLane(current: InboxLane, key: string): InboxLane | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') {
    return null;
  }
  const i = INBOX_LANES.indexOf(current);
  const step = key === 'ArrowRight' ? 1 : -1;
  return INBOX_LANES[(i + step + INBOX_LANES.length) % INBOX_LANES.length] ?? current;
}
