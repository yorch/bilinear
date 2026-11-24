import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import {
  IssueReminderInvalidTimeError,
  IssueReminderNotFoundError,
} from '../../services/issue-reminder.service';
import { issueReminderResolvers } from './issue-reminder';

const ISSUE_ID = '00000000-0000-0000-0000-000000000400';

describe('issueReminderResolvers', () => {
  let ctx: MockGraphQLContext;
  const anon = () => createMockContext({ orgId: null, userId: null });

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('requires authentication on every operation', async () => {
    await testAuthGuard(
      issueReminderResolvers.Mutation.issueReminderSet,
      { issueId: ISSUE_ID, remindAt: new Date() },
      anon(),
      'UNAUTHENTICATED',
    );
    await testAuthGuard(
      issueReminderResolvers.Mutation.issueReminderClear,
      { issueId: ISSUE_ID },
      anon(),
      'UNAUTHENTICATED',
    );
    await testAuthGuard(
      issueReminderResolvers.Query.myIssueReminders,
      {},
      anon(),
      'UNAUTHENTICATED',
    );
  });

  it('set scopes to the caller (ignores any other user) and returns the reminder', async () => {
    const reminder = { id: 'r1', issueId: ISSUE_ID };
    const spy = vi.spyOn(ctx.services.issueReminder, 'set').mockResolvedValue(reminder as never);
    const at = new Date(Date.now() + 3600_000);

    const out = await issueReminderResolvers.Mutation.issueReminderSet(
      {},
      { issueId: ISSUE_ID, remindAt: at },
      ctx as never,
    );

    expect(spy).toHaveBeenCalledWith(ctx.orgId, ctx.userId, ISSUE_ID, at);
    expect(out).toEqual({ reminder, success: true });
  });

  it('set remaps not-found (hidden/foreign issue) to NOT_FOUND', async () => {
    vi.spyOn(ctx.services.issueReminder, 'set').mockRejectedValue(new IssueReminderNotFoundError());
    await testAuthGuard(
      issueReminderResolvers.Mutation.issueReminderSet,
      { issueId: ISSUE_ID, remindAt: new Date() },
      ctx,
      'NOT_FOUND',
    );
  });

  it('set remaps a bad time to BAD_USER_INPUT', async () => {
    vi.spyOn(ctx.services.issueReminder, 'set').mockRejectedValue(
      new IssueReminderInvalidTimeError(),
    );
    await testAuthGuard(
      issueReminderResolvers.Mutation.issueReminderSet,
      { issueId: ISSUE_ID, remindAt: new Date() },
      ctx,
      'BAD_USER_INPUT',
    );
  });

  it('clear and list are scoped to the caller', async () => {
    const clear = vi.spyOn(ctx.services.issueReminder, 'clear').mockResolvedValue(true);
    const list = vi.spyOn(ctx.services.issueReminder, 'findPendingByUser').mockResolvedValue([]);

    await issueReminderResolvers.Mutation.issueReminderClear(
      {},
      { issueId: ISSUE_ID },
      ctx as never,
    );
    await issueReminderResolvers.Query.myIssueReminders({}, {}, ctx as never);

    expect(clear).toHaveBeenCalledWith(ctx.orgId, ctx.userId, ISSUE_ID);
    expect(list).toHaveBeenCalledWith(ctx.orgId, ctx.userId);
  });
});
