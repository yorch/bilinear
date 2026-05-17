import type { Notification, PrismaClient } from '../../generated/prisma';
import {
  sendAssignmentNotificationEmail,
  sendCommentNotificationEmail,
  sendMentionNotificationEmail,
  sendStatusChangeNotificationEmail,
} from '../lib/email';
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

  async findByUserId(userId: string, orgId: string, limit = 50): Promise<Notification[]> {
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
        type: 'ISSUE_COMMENT',
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
    actorName: string;
    issueIdentifier: string;
    issueTitle: string;
    issueUrl: string;
  } | null> {
    const [recipient, actor, issue] = await Promise.all([
      this.prisma.user.findUnique({
        select: { email: true, emailNotificationsEnabled: true },
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

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const workspaceKey = issue.team.organization.urlKey;

    return {
      actorName: actor.displayName,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      issueUrl: `${appUrl}/${workspaceKey}/issue/${issue.identifier}`,
      recipientEmail: recipient.email,
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
      to: ctx.recipientEmail,
    });
  }

  private async sendCommentEmails(
    recipientIds: string[],
    actorId: string,
    issueId: string,
    excerpt?: string,
  ): Promise<void> {
    const actor = await this.prisma.user.findUnique({
      select: { displayName: true },
      where: { id: actorId },
    });
    const issue = await this.prisma.issue.findUnique({
      select: {
        identifier: true,
        team: { select: { organization: { select: { urlKey: true } } } },
        title: true,
      },
      where: { id: issueId },
    });
    if (!actor || !issue) {
      return;
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const issueUrl = `${appUrl}/${issue.team.organization.urlKey}/issue/${issue.identifier}`;

    const recipients = await this.prisma.user.findMany({
      select: { email: true, emailNotificationsEnabled: true, id: true },
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

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const issueUrl = `${appUrl}/${issue.team.organization.urlKey}/issue/${issue.identifier}`;

    const recipients = await this.prisma.user.findMany({
      select: { email: true, emailNotificationsEnabled: true, id: true },
      where: { emailNotificationsEnabled: true, id: { in: recipientIds } },
    });

    await Promise.allSettled(
      recipients.map(r =>
        sendStatusChangeNotificationEmail({
          actorName: actor.displayName,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title,
          issueUrl,
          newStateName: newState.name,
          oldStateName: oldState.name,
          to: r.email,
        }),
      ),
    );
  }
}
