import type { Notification, NotificationType, Prisma, PrismaClient } from '../../generated/prisma';
import {
  sendAssignmentNotificationEmail,
  sendCommentNotificationEmail,
  sendMentionNotificationEmail,
  sendStatusChangeNotificationEmail,
} from '../lib/email';
import { isIssueVisible } from '../lib/entity-visibility';
import { env } from '../lib/env';
import { DEFAULT_LIST_LIMIT } from '../lib/limits';
import { childLogger } from '../lib/logger';
import { getSyncVisibility, getSyncVisibilityBatch } from '../lib/sync-visibility';

const log = childLogger({ module: 'notification' });

export interface NotificationCreateInput {
  actorId?: string;
  data?: Record<string, unknown>;
  issueId?: string;
  type: NotificationType;
  userId: string;
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Notification not found');
    this.name = 'NotificationNotFoundError';
  }
}

export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, input: NotificationCreateInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        actorId: input.actorId ?? null,
        data: (input.data ?? {}) as object,
        issueId: input.issueId ?? null,
        organizationId: orgId,
        type: input.type,
        userId: input.userId,
      },
    });
  }

  async findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  /**
   * Narrow a user's notifications to issues they can still see. A notification
   * outlives the access that produced it (the issue moved into a private team,
   * the user was demoted to guest), and its row carries the issue id and an
   * excerpt — so rows pointing at a hidden issue are left out of every read.
   */
  private async issueVisibilityWhere(
    userId: string,
    orgId: string,
  ): Promise<Prisma.NotificationWhereInput> {
    const vis = await getSyncVisibility(this.prisma, userId, orgId);
    if (vis.hiddenTeamIds.length === 0 && vis.guestTeamIds.length === 0) {
      return {};
    }
    return {
      OR: [
        { issueId: null },
        {
          issue: {
            AND: [
              ...(vis.hiddenTeamIds.length > 0 ? [{ teamId: { notIn: vis.hiddenTeamIds } }] : []),
              ...(vis.guestTeamIds.length > 0
                ? [
                    {
                      OR: [
                        { teamId: { notIn: vis.guestTeamIds } },
                        { creatorId: userId },
                        { assigneeId: userId },
                      ],
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    };
  }

  /**
   * Recipients (of `userIds`) who may still see `issueId`. Every fan-out path
   * runs its candidate list through this — a subscriber or @mentioned user
   * who lost access (issue moved to a private team, demoted to guest) must
   * not receive a row or an email carrying the issue's title or excerpt.
   */
  async filterVisibleRecipients(
    orgId: string,
    issueId: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }
    const issue = await this.prisma.issue.findUnique({
      select: { assigneeId: true, creatorId: true, organizationId: true, teamId: true },
      where: { id: issueId },
    });
    if (!issue || issue.organizationId !== orgId) {
      return [];
    }
    const scopes = await getSyncVisibilityBatch(
      this.prisma,
      userIds.map(userId => ({ orgId, userId })),
    );
    return userIds.filter((_, i) => {
      const scope = scopes[i];
      return scope ? isIssueVisible(scope, issue) : false;
    });
  }

  async findByUserId(
    userId: string,
    orgId: string,
    limit = DEFAULT_LIST_LIMIT,
    opts: { before?: Date; snoozed?: boolean } = {},
  ): Promise<Notification[]> {
    const now = new Date();
    const visibility = await this.issueVisibilityWhere(userId, orgId);
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      where: {
        AND: [visibility],
        // `snoozed` flips the visibility rule: the default list hides rows
        // until they wake, the Snoozed view shows exactly those rows.
        ...(opts.snoozed
          ? { snoozedUntilAt: { gt: now } }
          : { OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: now } }] }),
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
        organizationId: orgId,
        userId,
      },
    });
  }

  /** Put a read notification back to unread (clears `readAt`). */
  async markUnread(id: string, userId: string, orgId?: string): Promise<Notification> {
    await this.assertOwned(id, userId, orgId);
    return this.prisma.notification.update({
      data: { read: false, readAt: null },
      where: { id },
    });
  }

  /** Wake a snoozed notification immediately. */
  async unsnooze(id: string, userId: string, orgId?: string): Promise<Notification> {
    await this.assertOwned(id, userId, orgId);
    return this.prisma.notification.update({
      data: { snoozedUntilAt: null },
      where: { id },
    });
  }

  private async assertOwned(id: string, userId: string, orgId?: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (
      !notification ||
      notification.userId !== userId ||
      (orgId !== undefined && notification.organizationId !== orgId)
    ) {
      throw new NotificationNotFoundError();
    }
  }

  async markRead(id: string, userId: string, orgId?: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (
      !notification ||
      notification.userId !== userId ||
      (orgId !== undefined && notification.organizationId !== orgId)
    ) {
      throw new NotificationNotFoundError();
    }
    return this.prisma.notification.update({
      data: { read: true, readAt: new Date() },
      where: { id },
    });
  }

  async markAllRead(userId: string, orgId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      data: { read: true, readAt: new Date() },
      where: { organizationId: orgId, read: false, userId },
    });
    return { count: result.count };
  }

  async snooze(id: string, userId: string, until: Date, orgId?: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (
      !notification ||
      notification.userId !== userId ||
      (orgId !== undefined && notification.organizationId !== orgId)
    ) {
      throw new NotificationNotFoundError();
    }
    return this.prisma.notification.update({
      data: { snoozedUntilAt: until },
      where: { id },
    });
  }

  async delete(id: string): Promise<Notification> {
    return this.prisma.notification.delete({ where: { id } });
  }

  async getUnreadCount(userId: string, orgId: string): Promise<number> {
    const now = new Date();
    const visibility = await this.issueVisibilityWhere(userId, orgId);
    return this.prisma.notification.count({
      where: {
        AND: [visibility],
        OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: now } }],
        organizationId: orgId,
        read: false,
        userId,
      },
    });
  }

  async createForIssueAssignment(
    orgId: string,
    issueId: string,
    assigneeId: string,
    actorId: string,
  ): Promise<Notification | null> {
    if (assigneeId === actorId) {
      return null;
    }
    if ((await this.filterVisibleRecipients(orgId, issueId, [assigneeId])).length === 0) {
      return null;
    }
    const notification = await this.create(orgId, {
      actorId,
      data: { issueId },
      issueId,
      type: 'ISSUE_ASSIGNED',
      userId: assigneeId,
    });

    // Fire-and-forget email — never blocks mutation response
    void this.sendAssignmentEmail(assigneeId, actorId, issueId).catch(err =>
      log.error({ err }, 'Failed to send assignment notification email'),
    );

    return notification;
  }

  async createForStatusChange(
    orgId: string,
    issueId: string,
    actorId: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<{ count: number }> {
    const subscribers = await this.getSubscribers(issueId);

    const recipientIds = await this.filterVisibleRecipients(
      orgId,
      issueId,
      subscribers.filter(id => id !== actorId),
    );
    if (recipientIds.length === 0) {
      return { count: 0 };
    }

    const result = await this.prisma.notification.createMany({
      data: recipientIds.map(userId => ({
        actorId,
        data: { issueId, newStatus, oldStatus },
        issueId,
        organizationId: orgId,
        type: 'ISSUE_STATUS_CHANGED',
        userId,
      })),
    });

    // Fire-and-forget emails
    void this.sendStatusChangeEmails(recipientIds, actorId, issueId, oldStatus, newStatus).catch(
      err => log.error({ err }, 'Failed to send status change notification emails'),
    );

    return result;
  }

  async createForMention(
    orgId: string,
    issueId: string,
    mentionedUserId: string,
    actorId: string,
    excerpt?: string,
  ): Promise<Notification | null> {
    if (mentionedUserId === actorId) {
      return null;
    }
    if ((await this.filterVisibleRecipients(orgId, issueId, [mentionedUserId])).length === 0) {
      return null;
    }
    const notification = await this.create(orgId, {
      actorId,
      data: { excerpt, issueId },
      issueId,
      type: 'ISSUE_MENTIONED',
      userId: mentionedUserId,
    });

    void this.sendMentionEmail(mentionedUserId, actorId, issueId, excerpt).catch(err =>
      log.error({ err }, 'Failed to send mention notification email'),
    );

    return notification;
  }

  /**
   * Fan out @mention notifications parsed out of a comment's TipTap doc.
   * `bodyData` is client-authored editor state, so a mention node's
   * `attrs.id` could name ANY user id, including one with no relationship
   * to this issue's team (or a different org entirely) — access-control
   * gate: only notify mentioned ids that are actual members of `teamId` in
   * `orgId`, the same membership rule `requireTeamMember` enforces,
   * batched for every mentioned id in one query. Anyone already an issue
   * subscriber is skipped since `notifyCommentSubscribers` already
   * notified them — this only covers people newly pulled in by the
   * mention. `createForMention` itself no-ops a self-mention.
   *
   * Fire-and-forget by convention: callers (see `resolvers/comment.ts`)
   * invoke this without awaiting and attach their own `.catch` for
   * logging. The per-recipient `createForMention` calls run concurrently
   * (Promise.all) — each is independent, so there's no ordering
   * requirement between them.
   */
  async notifyMentions(params: {
    orgId: string;
    teamId: string;
    issueId: string;
    mentionedUserIds: string[];
    actorId: string;
    excerpt?: string;
    /**
     * Users already notified for this same comment by another path (the reply
     * target `notifyCommentSubscribers` returns) — skipped so a reply that
     * also @mentions its parent's author yields one notification, not two.
     */
    skipUserIds?: readonly string[];
  }): Promise<void> {
    const { orgId, teamId, issueId, mentionedUserIds, actorId, excerpt, skipUserIds } = params;
    if (mentionedUserIds.length === 0) {
      return;
    }
    const teamMembers = await this.prisma.teamMembership.findMany({
      select: { userId: true },
      where: {
        team: { organizationId: orgId },
        teamId,
        userId: { in: mentionedUserIds },
      },
    });
    const authorizedMentionedIds = new Set(teamMembers.map(m => m.userId));
    const subscribers = new Set(await this.getSubscribers(issueId));
    const skip = new Set(skipUserIds ?? []);
    const recipientIds = mentionedUserIds.filter(
      userId => authorizedMentionedIds.has(userId) && !subscribers.has(userId) && !skip.has(userId),
    );
    await Promise.all(
      recipientIds.map(userId => this.createForMention(orgId, issueId, userId, actorId, excerpt)),
    );
  }

  async subscribe(userId: string, issueId: string): Promise<void> {
    await this.prisma.notificationSubscription.upsert({
      create: { active: true, issueId, userId },
      update: { active: true },
      where: { userId_issueId: { issueId, userId } },
    });
  }

  async unsubscribe(userId: string, issueId: string): Promise<void> {
    await this.prisma.notificationSubscription.upsert({
      create: { active: false, issueId, userId },
      update: { active: false },
      where: { userId_issueId: { issueId, userId } },
    });
  }

  async isSubscribed(userId: string, issueId: string): Promise<boolean> {
    const subscription = await this.prisma.notificationSubscription.findUnique({
      where: { userId_issueId: { issueId, userId } },
    });
    return subscription?.active === true;
  }

  /**
   * Ids of the live issues the user is actively subscribed to in this org,
   * most recently subscribed first. Subscriptions are user-local (they never
   * produce a SyncAction), so the My Issues "Subscribed" tab asks for this set
   * and resolves the rows from its local issue pool. Archived and trashed
   * issues are left out, matching every other list.
   */
  async listSubscribedIssueIds(userId: string, orgId: string): Promise<string[]> {
    const subscriptions = await this.prisma.notificationSubscription.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { issueId: true },
      where: {
        active: true,
        issue: { archivedAt: null, organizationId: orgId, trashed: false },
        userId,
      },
    });
    return subscriptions.map(s => s.issueId);
  }

  async getSubscribers(issueId: string): Promise<string[]> {
    const subscriptions = await this.prisma.notificationSubscription.findMany({
      select: { userId: true },
      where: { active: true, issueId },
    });
    return subscriptions.map(s => s.userId);
  }

  /**
   * Ensure a subscription row exists for (userId, issueId), without
   * forcing an existing row back to active (an explicit unsubscribe
   * should stick). Implemented as an upsert with a no-op `update` rather
   * than the previous find-then-create: two near-simultaneous calls for
   * the same user/issue (e.g. concurrent comment + assignment on the same
   * request) used to race between the `findUnique` and the `create`,
   * throwing a P2002 unique-constraint violation when both lost the race.
   * Postgres resolves the upsert's insert-or-update atomically, so the
   * race can no longer surface as an error.
   */
  async autoSubscribe(userId: string, issueId: string): Promise<void> {
    await this.prisma.notificationSubscription.upsert({
      create: { active: true, issueId, userId },
      update: {},
      where: { userId_issueId: { issueId, userId } },
    });
  }

  /**
   * Author of the comment `commentId` replies to, or null when it is a
   * top-level comment, the parent is gone, the author is the actor, or the
   * author is no longer a member of the issue's team (so a reply never leaks
   * to someone who lost access). A guest parent author only counts while they
   * still created or are assigned the issue — the same visibility rule guests
   * get everywhere else.
   */
  private async resolveReplyTarget(commentId: string, actorId: string): Promise<string | null> {
    const comment = await this.prisma.comment.findUnique({
      select: {
        issue: { select: { assigneeId: true, creatorId: true, teamId: true } },
        parent: { select: { authorId: true } },
      },
      where: { id: commentId },
    });
    const parentAuthorId = comment?.parent?.authorId;
    if (!parentAuthorId || parentAuthorId === actorId || !comment.issue) {
      return null;
    }
    const membership = await this.prisma.teamMembership.findFirst({
      select: { userId: true },
      where: { teamId: comment.issue.teamId, userId: parentAuthorId },
    });
    if (!membership) {
      return null;
    }
    const role = await this.prisma.teamMemberRole.findUnique({
      select: { role: true },
      where: { teamId_userId: { teamId: comment.issue.teamId, userId: parentAuthorId } },
    });
    // Mirrors `getTeamRole`: an unrecognised role is least-privilege (guest).
    const isGuest = role != null && role.role !== 'member' && role.role !== 'admin';
    const ownsIssue =
      comment.issue.creatorId === parentAuthorId || comment.issue.assigneeId === parentAuthorId;
    if (isGuest && !ownsIssue) {
      return null;
    }
    return parentAuthorId;
  }

  async notifyCommentSubscribers(
    orgId: string,
    issueId: string,
    actorId: string,
    commentId: string,
    excerpt?: string,
  ): Promise<{ count: number; replyToUserId?: string }> {
    const subscribers = await this.getSubscribers(issueId);
    const replyToUserId = await this.resolveReplyTarget(commentId, actorId);
    const candidates = new Set(subscribers.filter(id => id !== actorId));
    // The parent comment's author is told about a direct reply even if they
    // never subscribed (or have since been dropped from the subscriber set).
    if (replyToUserId) {
      candidates.add(replyToUserId);
    }
    const recipientIds = await this.filterVisibleRecipients(orgId, issueId, [...candidates]);
    if (recipientIds.length === 0) {
      return { count: 0 };
    }

    const result = await this.prisma.notification.createMany({
      data: recipientIds.map(userId => ({
        actorId,
        // `replyToUserId` is the ONE reply marker: the inbox puts the row in
        // the Priority lane for the viewer it names, and in Other for every
        // other subscriber of the same thread.
        data: { commentId, excerpt, issueId, ...(replyToUserId ? { replyToUserId } : {}) },
        issueId,
        organizationId: orgId,
        type: 'ISSUE_COMMENTED',
        userId,
      })),
    });

    void this.sendCommentEmails(recipientIds, actorId, issueId, excerpt).catch(err =>
      log.error({ err }, 'Failed to send comment notification emails'),
    );

    return replyToUserId ? { ...result, replyToUserId } : result;
  }

  // ---------------------------------------------------------------------------
  // Private email helpers — resolve user/issue data then call email.ts senders
  // ---------------------------------------------------------------------------

  private async resolveEmailContext(
    recipientId: string,
    actorId: string,
    issueId: string,
  ): Promise<{
    recipientEmail: string;
    recipientLocale: string | null;
    actorName: string;
    issueIdentifier: string;
    issueTitle: string;
    issueUrl: string;
  } | null> {
    const [recipient, actor, issue] = await Promise.all([
      this.prisma.user.findUnique({
        select: { email: true, emailNotificationsEnabled: true, locale: true },
        where: { id: recipientId },
      }),
      this.prisma.user.findUnique({ select: { displayName: true }, where: { id: actorId } }),
      this.prisma.issue.findUnique({
        select: {
          identifier: true,
          team: { select: { organization: { select: { urlKey: true } } } },
          teamId: true,
          title: true,
        },
        where: { id: issueId },
      }),
    ]);

    if (!recipient?.emailNotificationsEnabled || !actor || !issue) {
      return null;
    }

    const appUrl = env.APP_URL;
    const workspaceKey = issue.team.organization.urlKey;

    return {
      actorName: actor.displayName,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      issueUrl: `${appUrl}/${workspaceKey}/issue/${issue.identifier}`,
      recipientEmail: recipient.email,
      recipientLocale: recipient.locale,
    };
  }

  private async sendAssignmentEmail(
    assigneeId: string,
    actorId: string,
    issueId: string,
  ): Promise<void> {
    const ctx = await this.resolveEmailContext(assigneeId, actorId, issueId);
    if (!ctx) {
      return;
    }
    await sendAssignmentNotificationEmail({
      actorName: ctx.actorName,
      issueIdentifier: ctx.issueIdentifier,
      issueTitle: ctx.issueTitle,
      issueUrl: ctx.issueUrl,
      locale: ctx.recipientLocale,
      to: ctx.recipientEmail,
    });
  }

  private async sendMentionEmail(
    mentionedUserId: string,
    actorId: string,
    issueId: string,
    excerpt?: string,
  ): Promise<void> {
    const ctx = await this.resolveEmailContext(mentionedUserId, actorId, issueId);
    if (!ctx) {
      return;
    }
    await sendMentionNotificationEmail({
      actorName: ctx.actorName,
      excerpt,
      issueIdentifier: ctx.issueIdentifier,
      issueTitle: ctx.issueTitle,
      issueUrl: ctx.issueUrl,
      locale: ctx.recipientLocale,
      to: ctx.recipientEmail,
    });
  }

  private async sendCommentEmails(
    recipientIds: string[],
    actorId: string,
    issueId: string,
    excerpt?: string,
  ): Promise<void> {
    const [actor, issue] = await Promise.all([
      this.prisma.user.findUnique({
        select: { displayName: true },
        where: { id: actorId },
      }),
      this.prisma.issue.findUnique({
        select: {
          identifier: true,
          team: { select: { organization: { select: { urlKey: true } } } },
          title: true,
        },
        where: { id: issueId },
      }),
    ]);
    if (!actor || !issue) {
      return;
    }

    const appUrl = env.APP_URL;
    const issueUrl = `${appUrl}/${issue.team.organization.urlKey}/issue/${issue.identifier}`;

    const recipients = await this.prisma.user.findMany({
      select: { email: true, emailNotificationsEnabled: true, id: true, locale: true },
      where: { emailNotificationsEnabled: true, id: { in: recipientIds } },
    });

    await Promise.allSettled(
      recipients.map(r =>
        sendCommentNotificationEmail({
          actorName: actor.displayName,
          excerpt,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title,
          issueUrl,
          locale: r.locale,
          to: r.email,
        }),
      ),
    );
  }

  private async sendStatusChangeEmails(
    recipientIds: string[],
    actorId: string,
    issueId: string,
    oldStateId: string,
    newStateId: string,
  ): Promise<void> {
    const [actor, issue, oldState, newState] = await Promise.all([
      this.prisma.user.findUnique({ select: { displayName: true }, where: { id: actorId } }),
      this.prisma.issue.findUnique({
        select: {
          identifier: true,
          team: { select: { organization: { select: { urlKey: true } } } },
          title: true,
        },
        where: { id: issueId },
      }),
      this.prisma.workflowState.findUnique({ select: { name: true }, where: { id: oldStateId } }),
      this.prisma.workflowState.findUnique({ select: { name: true }, where: { id: newStateId } }),
    ]);

    if (!actor || !issue || !oldState || !newState) {
      return;
    }

    const appUrl = env.APP_URL;
    const issueUrl = `${appUrl}/${issue.team.organization.urlKey}/issue/${issue.identifier}`;

    const recipients = await this.prisma.user.findMany({
      select: { email: true, emailNotificationsEnabled: true, id: true, locale: true },
      where: { emailNotificationsEnabled: true, id: { in: recipientIds } },
    });

    await Promise.allSettled(
      recipients.map(r =>
        sendStatusChangeNotificationEmail({
          actorName: actor.displayName,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title,
          issueUrl,
          locale: r.locale,
          newStateName: newState.name,
          oldStateName: oldState.name,
          to: r.email,
        }),
      ),
    );
  }
}
