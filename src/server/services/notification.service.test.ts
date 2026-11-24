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

  describe('listSubscribedIssueIds', () => {
    it('returns only active, live, same-org subscriptions for the user, newest first', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([
        { issueId: 'issue-b' },
        { issueId: 'issue-a' },
      ]);

      const ids = await service.listSubscribedIssueIds(TEST_USER.id, TEST_ORG.id);

      expect(ids).toEqual(['issue-b', 'issue-a']);
      expect(prisma.notificationSubscription.findMany).toHaveBeenCalledWith({
        orderBy: { updatedAt: 'desc' },
        select: { issueId: true },
        where: {
          active: true,
          issue: { archivedAt: null, organizationId: TEST_ORG.id, trashed: false },
          userId: TEST_USER.id,
        },
      });
    });

    it('returns an empty list when the user subscribes to nothing', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([]);
      expect(await service.listSubscribedIssueIds(TEST_USER.id, TEST_ORG.id)).toEqual([]);
    });
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

  describe('findByUserId snoozed / before', () => {
    it('lists only still-snoozed rows when snoozed is set', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      await service.findByUserId(TEST_USER.id, TEST_ORG.id, 50, { snoozed: true });
      const where = (prisma.notification.findMany.mock.calls[0] as [{ where: object }])[0].where;
      expect(where).toHaveProperty('snoozedUntilAt.gt');
      expect(where).not.toHaveProperty('OR');
    });

    it('pages older than the before cursor', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      const before = new Date('2026-01-01T00:00:00Z');
      await service.findByUserId(TEST_USER.id, TEST_ORG.id, 50, { before });
      const where = (prisma.notification.findMany.mock.calls[0] as [{ where: object }])[0].where;
      expect(where).toMatchObject({ createdAt: { lt: before } });
    });
  });

  describe('markUnread / unsnooze', () => {
    it('markUnread clears read and readAt', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...TEST_NOTIFICATION,
        organizationId: TEST_ORG.id,
        userId: TEST_USER.id,
      });
      prisma.notification.update.mockResolvedValue(TEST_NOTIFICATION);
      await service.markUnread(TEST_NOTIFICATION.id, TEST_USER.id, TEST_ORG.id);
      expect(prisma.notification.update).toHaveBeenCalledWith({
        data: { read: false, readAt: null },
        where: { id: TEST_NOTIFICATION.id },
      });
    });

    it('unsnooze rejects another user notification', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...TEST_NOTIFICATION,
        userId: 'someone-else',
      });
      await expect(
        service.unsnooze(TEST_NOTIFICATION.id, TEST_USER.id, TEST_ORG.id),
      ).rejects.toThrow('Notification not found');
      expect(prisma.notification.update).not.toHaveBeenCalled();
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
  describe('notifyCommentSubscribers', () => {
    const COMMENT_ID = '00000000-0000-0000-0000-000000000c01';
    const PARENT_AUTHOR = TEST_USER_2.id;
    const ACTOR = '00000000-0000-0000-0000-0000000000a7';
    const BYSTANDER = '00000000-0000-0000-0000-0000000000b8';

    function rows(): Array<{ data: Record<string, unknown>; userId: string }> {
      return prisma.notification.createMany.mock.calls[0]?.[0].data;
    }

    beforeEach(() => {
      prisma.notification.createMany.mockResolvedValue({ count: 0 });
    });

    it('adds no reply marker to a top-level comment', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([{ userId: BYSTANDER }]);
      prisma.comment.findUnique.mockResolvedValue({
        issue: { teamId: 't1' },
        parent: null,
      });

      await service.notifyCommentSubscribers(TEST_ORG.id, TEST_ISSUE.id, ACTOR, COMMENT_ID);

      expect(rows()).toHaveLength(1);
      expect(rows()[0]?.data).not.toHaveProperty('replyToUserId');
      expect(prisma.teamMembership.findFirst).not.toHaveBeenCalled();
    });

    it('marks every row of a reply and notifies a non-subscribed parent author', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([{ userId: BYSTANDER }]);
      prisma.comment.findUnique.mockResolvedValue({
        issue: { teamId: 't1' },
        parent: { authorId: PARENT_AUTHOR },
      });
      prisma.teamMembership.findFirst.mockResolvedValue({ userId: PARENT_AUTHOR });

      await service.notifyCommentSubscribers(TEST_ORG.id, TEST_ISSUE.id, ACTOR, COMMENT_ID);

      expect(
        rows()
          .map(r => r.userId)
          .sort(),
      ).toEqual([BYSTANDER, PARENT_AUTHOR].sort());
      for (const r of rows()) {
        expect(r.data).toMatchObject({ commentId: COMMENT_ID, replyToUserId: PARENT_AUTHOR });
      }
    });

    it('does not duplicate a parent author who already subscribes', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([{ userId: PARENT_AUTHOR }]);
      prisma.comment.findUnique.mockResolvedValue({
        issue: { teamId: 't1' },
        parent: { authorId: PARENT_AUTHOR },
      });
      prisma.teamMembership.findFirst.mockResolvedValue({ userId: PARENT_AUTHOR });

      await service.notifyCommentSubscribers(TEST_ORG.id, TEST_ISSUE.id, ACTOR, COMMENT_ID);

      expect(rows()).toHaveLength(1);
    });

    it('does not notify the actor when replying to their own comment', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([]);
      prisma.comment.findUnique.mockResolvedValue({
        issue: { teamId: 't1' },
        parent: { authorId: ACTOR },
      });
      prisma.teamMembership.findFirst.mockResolvedValue({ userId: ACTOR });

      const result = await service.notifyCommentSubscribers(
        TEST_ORG.id,
        TEST_ISSUE.id,
        ACTOR,
        COMMENT_ID,
      );

      expect(result).toEqual({ count: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('skips a parent author who is no longer on the issue team', async () => {
      prisma.notificationSubscription.findMany.mockResolvedValue([{ userId: BYSTANDER }]);
      prisma.comment.findUnique.mockResolvedValue({
        issue: { teamId: 't1' },
        parent: { authorId: PARENT_AUTHOR },
      });
      prisma.teamMembership.findFirst.mockResolvedValue(null);

      await service.notifyCommentSubscribers(TEST_ORG.id, TEST_ISSUE.id, ACTOR, COMMENT_ID);

      expect(rows().map(r => r.userId)).toEqual([BYSTANDER]);
      expect(rows()[0]?.data).not.toHaveProperty('replyToUserId');
    });
  });
});
