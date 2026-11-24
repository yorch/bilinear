const NOTIFICATION_FIELDS = `
  id type read readAt snoozedUntilAt data createdAt
  userId actorId issueId organizationId updatedAt
`;

/**
 * First page plus the server's own unread total in one round trip. The total is
 * what the badge shows: the page is capped, and counting it undercounts.
 */
export const NOTIFICATIONS_WITH_COUNT_QUERY = `
  query NotificationsWithCount($limit: Int) {
    notifications(limit: $limit) { ${NOTIFICATION_FIELDS} }
    notificationUnreadCount
  }
`;

/** An older page, or the still-snoozed rows when `snoozed` is true. */
export const NOTIFICATIONS_PAGE_QUERY = `
  query NotificationsPage($limit: Int, $before: DateTime, $snoozed: Boolean) {
    notifications(limit: $limit, before: $before, snoozed: $snoozed) { ${NOTIFICATION_FIELDS} }
  }
`;

export const NOTIFICATION_MARK_UNREAD_MUTATION = `
  mutation NotificationMarkUnread($id: ID!) {
    notificationMarkUnread(id: $id) { success lastSyncId }
  }
`;

export const NOTIFICATION_UNSNOOZE_MUTATION = `
  mutation NotificationUnsnooze($id: ID!) {
    notificationUnsnooze(id: $id) { success lastSyncId }
  }
`;
