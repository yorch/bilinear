import type { IssueReminder } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const REMINDER_ERRORS = {
  BAD_USER_INPUT: ['IssueReminderInvalidTimeError'],
  NOT_FOUND: ['IssueReminderNotFoundError'],
} as const;

/**
 * Reminders are private to their owner and are not replicated through
 * SyncActions (those broadcast org-wide). The client reads them with
 * `myIssueReminders`; the notification a firing reminder produces *is* synced.
 * Every operation is scoped to `ctx.userId`, so there is no way to name
 * another user's reminder.
 */
export const issueReminderResolvers = {
  IssueReminder: {
    issue: (reminder: IssueReminder, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.issueById.load(reminder.issueId),
  },
  Mutation: {
    issueReminderClear: async (
      _parent: unknown,
      { issueId }: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await ctx.services.issueReminder.clear(ctx.orgId, ctx.userId, issueId);
      return { success: true };
    },
    issueReminderSet: async (
      _parent: unknown,
      { issueId, remindAt }: { issueId: string; remindAt: string | Date },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        const reminder = await ctx.services.issueReminder.set(
          ctx.orgId,
          ctx.userId,
          issueId,
          remindAt,
        );
        return { reminder, success: true };
      } catch (err) {
        mapServiceError(err, REMINDER_ERRORS);
      }
    },
  },
  Query: {
    myIssueReminders: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.issueReminder.findPendingByUser(ctx.orgId, ctx.userId);
    },
  },
};
