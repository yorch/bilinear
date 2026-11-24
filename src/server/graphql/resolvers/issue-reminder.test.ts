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

  let syncSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ctx = createMockContext();
    syncSpy = vi.spyOn(ctx.services.sync, 'createSyncAction');
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
  });

  it('set scopes to the caller, emits an I SyncAction carrying userId and returns lastSyncId', async () => {
    const reminder = { id: 'r1', issueId: ISSUE_ID, userId: ctx.userId };
    const spy = vi
      .spyOn(ctx.services.issueReminder, 'set')
      .mockResolvedValue({ created: true, reminder } as never);
    const at = new Date(Date.now() + 3600_000);

    const out = await issueReminderResolvers.Mutation.issueReminderSet(
      {},
      { issueId: ISSUE_ID, remindAt: at },
      ctx as never,
    );

    expect(spy).toHaveBeenCalledWith(ctx.orgId, ctx.userId, ISSUE_ID, at);
    expect(syncSpy).toHaveBeenCalledWith(
      ctx.orgId,
      'I',
      'IssueReminder',
      'r1',
      expect.objectContaining({ userId: ctx.userId }),
    );
    expect(out).toEqual({ lastSyncId: '1', reminder, success: true });
  });

  it('set emits a U when it moved an existing reminder', async () => {
    const reminder = { id: 'r1', issueId: ISSUE_ID, userId: ctx.userId };
    vi.spyOn(ctx.services.issueReminder, 'set').mockResolvedValue({
      created: false,
      reminder,
    } as never);
    await issueReminderResolvers.Mutation.issueReminderSet(
      {},
      { issueId: ISSUE_ID, remindAt: new Date(Date.now() + 3600_000) },
      ctx as never,
    );
    expect(syncSpy).toHaveBeenCalledWith(ctx.orgId, 'U', 'IssueReminder', 'r1', expect.anything());
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

  it('clear is scoped to the caller and emits a D whose payload carries userId', async () => {
    const removed = { id: 'r1', issueId: ISSUE_ID, userId: ctx.userId };
    const clear = vi.spyOn(ctx.services.issueReminder, 'clear').mockResolvedValue(removed as never);

    const out = await issueReminderResolvers.Mutation.issueReminderClear(
      {},
      { issueId: ISSUE_ID },
      ctx as never,
    );

    expect(clear).toHaveBeenCalledWith(ctx.orgId, ctx.userId, ISSUE_ID);
    expect(syncSpy).toHaveBeenCalledWith(
      ctx.orgId,
      'D',
      'IssueReminder',
      'r1',
      expect.objectContaining({ userId: ctx.userId }),
    );
    expect(out).toEqual({ lastSyncId: '1', success: true });
  });

  it('clear with nothing to clear emits no SyncAction but still succeeds', async () => {
    vi.spyOn(ctx.services.issueReminder, 'clear').mockResolvedValue(null);
    const out = await issueReminderResolvers.Mutation.issueReminderClear(
      {},
      { issueId: ISSUE_ID },
      ctx as never,
    );
    expect(syncSpy).not.toHaveBeenCalled();
    expect(out.success).toBe(true);
  });
});
