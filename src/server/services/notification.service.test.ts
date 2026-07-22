import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ISSUE, TEST_ORG, TEST_USER, TEST_USER_2 } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { NotificationNotFoundError, NotificationService } from './notification.service';

const TEST_NOTIFICATION = {
  actorId: TEST_USER_2.id,
  createdAt: new Date('2026-02-15T00:00:00Z'),
  data: {},
  id: '00000000-0000-0000-0000-000000000900',
  issueId: TEST_ISSUE.id,
  organizationId: TEST_ORG.id,
  read: false,
  readAt: null,
  snoozedUntilAt: null,
  type: 'ISSUE_ASSIGNED',
  updatedAt: new Date('2026-02-15T00:00:00Z'),
  userId: TEST_USER.id,
};

describe('NotificationService', () => {
  let prisma: MockPrismaClient;
  let service: NotificationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new NotificationService(prisma as never);
  });

  describe('create', () => {
    it('creates notification with correct data', async () => {
      prisma.notification.create.mockResolvedValue(TEST_NOTIFICATION);

      const result = await service.create(TEST_ORG.id, {
        actorId: TEST_USER_2.id,
        issueId: TEST_ISSUE.id,
        type: 'ISSUE_ASSIGNED',
        userId: TEST_USER.id,
      });

      expect(result).toEqual(TEST_NOTIFICATION);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          actorId: TEST_USER_2.id,
          data: {},
          issueId: TEST_ISSUE.id,
          organizationId: TEST_ORG.id,
          type: 'ISSUE_ASSIGNED',
          userId: TEST_USER.id,
        },
      });
    });
  });

  describe('findByUserId', () => {
    it('scopes results to userId and orgId', async () => {
      prisma.notification.findMany.mockResolvedValue([TEST_NOTIFICATION]);

      const result = await service.findByUserId(TEST_USER.id, TEST_ORG.id);

      expect(result).toEqual([TEST_NOTIFICATION]);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: TEST_ORG.id,
            userId: TEST_USER.id,
          }),
        }),
      );
    });
  });

  describe('markRead', () => {
    it('marks notification as read', async () => {
      const readNotification = {
        ...TEST_NOTIFICATION,
        read: true,
        readAt: new Date(),
      };
      prisma.notification.findUnique.mockResolvedValue(TEST_NOTIFICATION);
      prisma.notification.update.mockResolvedValue(readNotification);

      const result = await service.markRead(TEST_NOTIFICATION.id, TEST_USER.id);

      expect(result.read).toBe(true);
      expect(prisma.notification.update).toHaveBeenCalledWith({
        data: { read: true, readAt: expect.any(Date) },
        where: { id: TEST_NOTIFICATION.id },
      });
    });

    it('throws NotificationNotFoundError when notification belongs to different user', async () => {
      prisma.notification.findUnique.mockResolvedValue(TEST_NOTIFICATION);

      await expect(service.markRead(TEST_NOTIFICATION.id, TEST_USER_2.id)).rejects.toThrow(
        NotificationNotFoundError,
      );
    });
  });

  describe('markAllRead', () => {
    it('updates all unread notifications for user/org', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllRead(TEST_USER.id, TEST_ORG.id);

      expect(result).toEqual({ count: 5 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        data: { read: true, readAt: expect.any(Date) },
        where: {
          organizationId: TEST_ORG.id,
          read: false,
          userId: TEST_USER.id,
        },
      });
    });
  });

  describe('snooze', () => {
    it('sets snoozedUntilAt', async () => {
      const until = new Date('2026-02-20T00:00:00Z');
      const snoozed = { ...TEST_NOTIFICATION, snoozedUntilAt: until };
      prisma.notification.findUnique.mockResolvedValue(TEST_NOTIFICATION);
      prisma.notification.update.mockResolvedValue(snoozed);

      const result = await service.snooze(TEST_NOTIFICATION.id, TEST_USER.id, until);

      expect(result.snoozedUntilAt).toEqual(until);
      expect(prisma.notification.update).toHaveBeenCalledWith({
        data: { snoozedUntilAt: until },
        where: { id: TEST_NOTIFICATION.id },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('calls count with correct where clause', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount(TEST_USER.id, TEST_ORG.id);

      expect(result).toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: expect.any(Date) } }],
          organizationId: TEST_ORG.id,
          read: false,
          userId: TEST_USER.id,
        },
      });
    });
  });

  describe('createForIssueAssignment', () => {
    it('creates ISSUE_ASSIGNED notification', async () => {
      prisma.notification.create.mockResolvedValue(TEST_NOTIFICATION);

      const result = await service.createForIssueAssignment(
        TEST_ORG.id,
        TEST_ISSUE.id,
        TEST_USER.id,
        TEST_USER_2.id,
      );

      expect(result).toEqual(TEST_NOTIFICATION);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: TEST_USER_2.id,
            type: 'ISSUE_ASSIGNED',
            userId: TEST_USER.id,
          }),
        }),
      );
    });

    it('does not create notification when assigneeId === actorId', async () => {
      const result = await service.createForIssueAssignment(
        TEST_ORG.id,
        TEST_ISSUE.id,
        TEST_USER.id,
        TEST_USER.id,
      );

      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('upserts subscription with active=true', async () => {
      prisma.notificationSubscription.upsert.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });

      await service.subscribe(TEST_USER.id, TEST_ISSUE.id);

      expect(prisma.notificationSubscription.upsert).toHaveBeenCalledWith({
        create: { active: true, issueId: TEST_ISSUE.id, userId: TEST_USER.id },
        update: { active: true },
        where: {
          userId_issueId: { issueId: TEST_ISSUE.id, userId: TEST_USER.id },
        },
      });
    });
  });

  describe('unsubscribe', () => {
    it('upserts subscription with active=false', async () => {
      prisma.notificationSubscription.upsert.mockResolvedValue({
        active: false,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });

      await service.unsubscribe(TEST_USER.id, TEST_ISSUE.id);

      expect(prisma.notificationSubscription.upsert).toHaveBeenCalledWith({
        create: { active: false, issueId: TEST_ISSUE.id, userId: TEST_USER.id },
        update: { active: false },
        where: {
          userId_issueId: { issueId: TEST_ISSUE.id, userId: TEST_USER.id },
        },
      });
    });
  });

  describe('autoSubscribe', () => {
    // autoSubscribe is now an upsert (see notification.service.ts) rather
    // than a find-then-create, so two near-simultaneous calls for the same
    // (userId, issueId) can no longer race into a P2002 unique-constraint
    // error — Postgres resolves the insert-or-update atomically. The
    // `update: {}` no-op preserves "does not override an existing
    // subscription" (e.g. a prior explicit unsubscribe stays unsubscribed).
    it('upserts with a no-op update so an existing subscription is not overridden', async () => {
      prisma.notificationSubscription.upsert.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });

      await service.autoSubscribe(TEST_USER.id, TEST_ISSUE.id);

      expect(prisma.notificationSubscription.upsert).toHaveBeenCalledWith({
        create: { active: true, issueId: TEST_ISSUE.id, userId: TEST_USER.id },
        update: {},
        where: {
          userId_issueId: { issueId: TEST_ISSUE.id, userId: TEST_USER.id },
        },
      });
    });
  });
});
