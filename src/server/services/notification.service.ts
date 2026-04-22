import type { Notification, PrismaClient } from '../../generated/prisma';

export interface NotificationCreateInput {
  userId: string;
  issueId?: string;
  actorId?: string;
  type: string;
  data?: Record<string, unknown>;
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Notification not found');
    this.name = 'NotificationNotFoundError';
  }
}

export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  async create(
    orgId: string,
    input: NotificationCreateInput,
  ): Promise<Notification> {
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
    limit = 50,
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
    // Don't notify if user is assigning themselves
    if (assigneeId === actorId) {
      return null;
    }
    return this.create(orgId, {
      actorId,
      data: { issueId },
      issueId,
      type: 'ISSUE_ASSIGNED',
      userId: assigneeId,
    });
  }

  async createForStatusChange(
    orgId: string,
    issueId: string,
    actorId: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<{ count: number }> {
    const subscribers = await this.getSubscribers(issueId);

    // Don't notify the actor
    const recipientIds = subscribers.filter(id => id !== actorId);
    if (recipientIds.length === 0) {
      return { count: 0 };
    }

    // Single INSERT instead of N round-trips — a popular issue with dozens
    // of subscribers was paying 50-200ms of serial Prisma creates per
    // status change before.
    return this.prisma.notification.createMany({
      data: recipientIds.map(userId => ({
        actorId,
        data: { issueId, newStatus, oldStatus },
        issueId,
        organizationId: orgId,
        type: 'ISSUE_STATUS_CHANGED',
        userId,
      })),
    });
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
    // Only subscribe if no existing record — don't override an explicit unsubscribe
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
  ): Promise<{ count: number }> {
    const subscribers = await this.getSubscribers(issueId);
    const recipientIds = subscribers.filter(id => id !== actorId);
    if (recipientIds.length === 0) {
      return { count: 0 };
    }

    return this.prisma.notification.createMany({
      data: recipientIds.map(userId => ({
        actorId,
        data: { commentId, issueId },
        issueId,
        organizationId: orgId,
        type: 'ISSUE_COMMENT',
        userId,
      })),
    });
  }
}
