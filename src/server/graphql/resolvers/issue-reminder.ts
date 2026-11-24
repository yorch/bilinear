import type { IssueReminder } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const REMINDER_ERRORS = {
  BAD_USER_INPUT: ['IssueReminderInvalidTimeError'],
  NOT_FOUND: ['IssueReminderNotFoundError'],
} as const;

/**
 * Reminders are private to their owner but replicate like any entity: every
 * mutation emits an `I`/`U`/`D` SyncAction whose payload carries `userId`, and
 * every sync path drops per-user rows that are not the recipient's
 * (`dropForeignUserRows`). Every operation is scoped to `ctx.userId`, so there
 * is no way to name another user's reminder.
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
      const removed = await ctx.services.issueReminder.clear(ctx.orgId, ctx.userId, issueId);
      if (!removed) {
        return { lastSyncId: await ctx.services.sync.getLastSyncId(ctx.orgId), success: true };
      }
      // The payload (not null) carries `userId` so the per-user filter can
      // keep this delete away from every other member.
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'IssueReminder',
        removed.id,
        removed,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },
    issueReminderSet: async (
      _parent: unknown,
      { issueId, remindAt }: { issueId: string; remindAt: string | Date },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        const { created, reminder } = await ctx.services.issueReminder.set(
          ctx.orgId,
          ctx.userId,
          issueId,
          remindAt,
        );
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          created ? 'I' : 'U',
          'IssueReminder',
          reminder.id,
          reminder,
        );
        return { lastSyncId: sync.id.toString(), reminder, success: true };
      } catch (err) {
        mapServiceError(err, REMINDER_ERRORS);
      }
    },
  },
};
