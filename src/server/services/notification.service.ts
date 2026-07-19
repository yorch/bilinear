import type { Notification, PrismaClient } from '../../generated/prisma';
import {
  sendAssignmentNotificationEmail,
  sendCommentNotificationEmail,
  sendMentionNotificationEmail,
  sendStatusChangeNotificationEmail,
} from '../lib/email';
import { env } from '../lib/env';
import { DEFAULT_LIST_LIMIT } from '../lib/limits';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'notification' });

export interface NotificationCreateInput {
  actorId?: string;
  data?: Record<string, unknown>;
  issueId?: string;
  type: string;
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

  async findByUserId(
    userId: string,
    orgId: string,
    limit = DEFAULT_LIST_LIMIT,
  ): Promise<Notification[]> {
    const now = new Date();
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      where: {
        OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: now } }],
        organizationId: orgId,
        userId,
      },
    });
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== userId) {
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

  async snooze(id: string, userId: string, until: Date): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== userId) {
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
    return this.prisma.notification.count({
      where: {
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

    const recipientIds = subscribers.filter(id => id !== actorId);
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
  }): Promise<void> {
    const { orgId, teamId, issueId, mentionedUserIds, actorId, excerpt } = params;
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
    const recipientIds = mentionedUserIds.filter(
      userId => authorizedMentionedIds.has(userId) && !subscribers.has(userId),
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

  async getSubscribers(issueId: string): Promise<string[]> {
    const subscriptions = await this.prisma.notificationSubscription.findMany({
      select: { userId: true },
      where: { active: true, issueId },
    });
    return subscriptions.map(s => s.userId);
  }

  async autoSubscribe(userId: string, issueId: string): Promise<void> {
    const existing = await this.prisma.notificationSubscription.findUnique({
      where: { userId_issueId: { issueId, userId } },
    });
    if (!existing) {
      await this.prisma.notificationSubscription.create({
        data: { active: true, issueId, userId },
      });
    }
  }

  async notifyCommentSubscribers(
    orgId: string,
    issueId: string,
    actorId: string,
    commentId: string,
    excerpt?: string,
  ): Promise<{ count: number }> {
    const subscribers = await this.getSubscribers(issueId);
    const recipientIds = subscribers.filter(id => id !== actorId);
    if (recipientIds.length === 0) {
      return { count: 0 };
    }

    const result = await this.prisma.notification.createMany({
      data: recipientIds.map(userId => ({
        actorId,
        data: { commentId, excerpt, issueId },
        issueId,
        organizationId: orgId,
        type: 'ISSUE_COMMENTED',
        userId,
      })),
    });

    void this.sendCommentEmails(recipientIds, actorId, issueId, excerpt).catch(err =>
      log.error({ err }, 'Failed to send comment notification emails'),
    );

    return result;
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
