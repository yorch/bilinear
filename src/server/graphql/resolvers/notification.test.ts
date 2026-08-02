import { beforeEach, describe, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ISSUE } from '../../../test/fixtures';
import { NotificationNotFoundError } from '../../services/notification.service';
import { notificationResolvers } from './notification';

const TEST_NOTIFICATION_ID = '00000000-0000-0000-0000-000000000700';

describe('notificationResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('Mutation.notificationMarkAllRead', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Mutation.notificationMarkAllRead,
        {},
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });
  });

  describe('Mutation.notificationMarkRead', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Mutation.notificationMarkRead,
        { id: TEST_NOTIFICATION_ID },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('remaps NotificationNotFoundError to NOT_FOUND', async () => {
      vi.spyOn(ctx.services.notification, 'markRead').mockRejectedValue(
        new NotificationNotFoundError(),
      );

      await testAuthGuard(
        notificationResolvers.Mutation.notificationMarkRead,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.notificationSnooze', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Mutation.notificationSnooze,
        { id: TEST_NOTIFICATION_ID, until: new Date().toISOString() },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('remaps NotificationNotFoundError to NOT_FOUND', async () => {
      vi.spyOn(ctx.services.notification, 'snooze').mockRejectedValue(
        new NotificationNotFoundError(),
      );

      await testAuthGuard(
        notificationResolvers.Mutation.notificationSnooze,
        { id: 'missing', until: new Date().toISOString() },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.notificationSubscribe', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Mutation.notificationSubscribe,
        { issueId: TEST_ISSUE.id },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        notificationResolvers.Mutation.notificationSubscribe,
        { issueId: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the issue team', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        notificationResolvers.Mutation.notificationSubscribe,
        { issueId: TEST_ISSUE.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Mutation.notificationUnsubscribe', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Mutation.notificationUnsubscribe,
        { issueId: TEST_ISSUE.id },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        notificationResolvers.Mutation.notificationUnsubscribe,
        { issueId: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the issue team', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        notificationResolvers.Mutation.notificationUnsubscribe,
        { issueId: TEST_ISSUE.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Query.notificationIsSubscribed', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Query.notificationIsSubscribed,
        { issueId: TEST_ISSUE.id },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        notificationResolvers.Query.notificationIsSubscribed,
        { issueId: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the issue team', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        notificationResolvers.Query.notificationIsSubscribed,
        { issueId: TEST_ISSUE.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Query.notifications', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Query.notifications,
        {},
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });
  });

  describe('Query.notificationUnreadCount', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        notificationResolvers.Query.notificationUnreadCount,
        {},
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });
  });
});
