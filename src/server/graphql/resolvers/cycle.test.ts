import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ORG, TEST_TEAM, TEST_USER } from '../../../test/fixtures';
import { CycleService } from '../../services/cycle.service';
import { cycleResolvers } from './cycle';

const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000ff';

const ARCHIVED_CYCLE = {
  archivedAt: new Date('2026-03-01T00:00:00Z'),
  id: '00000000-0000-0000-0000-000000000c10',
  organizationId: TEST_ORG.id,
  teamId: TEST_TEAM.id,
};

// The shared mock context has no CycleService; build a superset over the same
// mock Prisma (the same approach as the custom-field resolver tests).
type CtxWithCycle = MockGraphQLContext & {
  services: MockGraphQLContext['services'] & { cycle: CycleService };
};

function createCtx(overrides?: Partial<{ orgId: string | null; userId: string | null }>) {
  const base = createMockContext(overrides);
  return {
    ...base,
    services: { ...base.services, cycle: new CycleService(base.prisma as never) },
  } as CtxWithCycle;
}

function memberOf(ctx: CtxWithCycle, teamOrgId = TEST_ORG.id) {
  ctx.prisma.teamMembership.findUnique.mockResolvedValue({
    team: { organizationId: teamOrgId },
    teamId: TEST_TEAM.id,
    userId: TEST_USER.id,
  });
}

describe('cycleResolvers Mutation.cycleUnarchive', () => {
  let ctx: CtxWithCycle;

  beforeEach(() => {
    ctx = createCtx();
  });

  it('throws UNAUTHENTICATED when not logged in', async () => {
    await testAuthGuard(
      cycleResolvers.Mutation.cycleUnarchive,
      { id: ARCHIVED_CYCLE.id },
      createCtx({ orgId: null, userId: null }),
      'UNAUTHENTICATED',
    );
  });

  it('throws NOT_FOUND for a missing cycle and writes nothing', async () => {
    ctx.prisma.cycle.findUnique.mockResolvedValue(null);

    await testAuthGuard(
      cycleResolvers.Mutation.cycleUnarchive,
      { id: 'missing' },
      ctx,
      'NOT_FOUND',
    );
    expect(ctx.prisma.cycle.update).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND for a cycle id from another organization and writes nothing', async () => {
    ctx.prisma.cycle.findUnique.mockResolvedValue({
      ...ARCHIVED_CYCLE,
      organizationId: OTHER_ORG_ID,
    });
    memberOf(ctx);
    const syncSpy = vi.spyOn(ctx.services.sync, 'createSyncAction');

    await testAuthGuard(
      cycleResolvers.Mutation.cycleUnarchive,
      { id: ARCHIVED_CYCLE.id },
      ctx,
      'NOT_FOUND',
    );
    expect(ctx.prisma.cycle.update).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN for a non-member of the cycle team and writes nothing', async () => {
    ctx.prisma.cycle.findUnique.mockResolvedValue(ARCHIVED_CYCLE);
    ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);
    const syncSpy = vi.spyOn(ctx.services.sync, 'createSyncAction');

    await testAuthGuard(
      cycleResolvers.Mutation.cycleUnarchive,
      { id: ARCHIVED_CYCLE.id },
      ctx,
      'FORBIDDEN',
    );
    expect(ctx.prisma.cycle.update).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the membership belongs to a team in another organization', async () => {
    ctx.prisma.cycle.findUnique.mockResolvedValue(ARCHIVED_CYCLE);
    memberOf(ctx, OTHER_ORG_ID);

    await testAuthGuard(
      cycleResolvers.Mutation.cycleUnarchive,
      { id: ARCHIVED_CYCLE.id },
      ctx,
      'FORBIDDEN',
    );
    expect(ctx.prisma.cycle.update).not.toHaveBeenCalled();
  });

  it('refuses with BAD_USER_INPUT when an active cycle now covers the dates, writing nothing', async () => {
    ctx.prisma.cycle.findUnique.mockResolvedValue({
      ...ARCHIVED_CYCLE,
      endsAt: new Date('2031-01-15T00:00:00Z'),
      startsAt: new Date('2031-01-01T00:00:00Z'),
    });
    ctx.prisma.cycle.findFirst.mockResolvedValue({ id: 'cycle-b' });
    memberOf(ctx);
    const syncSpy = vi.spyOn(ctx.services.sync, 'createSyncAction');

    await testAuthGuard(
      cycleResolvers.Mutation.cycleUnarchive,
      { id: ARCHIVED_CYCLE.id },
      ctx,
      'BAD_USER_INPUT',
    );
    expect(ctx.prisma.cycle.update).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('restores the cycle and emits a U SyncAction carrying it', async () => {
    const restored = { ...ARCHIVED_CYCLE, archivedAt: null };
    ctx.prisma.cycle.findUnique.mockResolvedValue(ARCHIVED_CYCLE);
    ctx.prisma.cycle.update.mockResolvedValue(restored);
    memberOf(ctx);
    const syncSpy = vi.spyOn(ctx.services.sync, 'createSyncAction');

    const result = await cycleResolvers.Mutation.cycleUnarchive(
      null,
      { id: ARCHIVED_CYCLE.id },
      ctx as never,
    );

    expect(ctx.prisma.cycle.update).toHaveBeenCalledWith({
      data: { archivedAt: null },
      where: { id: ARCHIVED_CYCLE.id },
    });
    expect(syncSpy).toHaveBeenCalledWith(TEST_ORG.id, 'U', 'Cycle', ARCHIVED_CYCLE.id, restored);
    expect(result).toEqual({ cycle: restored, lastSyncId: '1', success: true });
  });

  // Cycle writes are not guest-visible work: a guest-role team member is
  // refused on every cycle write, archive and unarchive included.
  it.each([
    ['cycleUnarchive', { id: ARCHIVED_CYCLE.id }],
    ['cycleArchive', { id: ARCHIVED_CYCLE.id }],
    ['cycleDelete', { id: ARCHIVED_CYCLE.id }],
    ['cycleUpdate', { id: ARCHIVED_CYCLE.id, input: { name: 'x' } }],
    ['cycleCreate', { input: { teamId: TEST_TEAM.id } }],
    ['cycleRollover', { cycleId: ARCHIVED_CYCLE.id }],
  ] as const)('%s rejects a guest-role team member', async (name, args) => {
    ctx.prisma.cycle.findUnique.mockResolvedValue(ARCHIVED_CYCLE);
    memberOf(ctx);
    ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });
    ctx.orgRole = 'guest';

    await testAuthGuard(
      (cycleResolvers.Mutation as unknown as Record<string, never>)[name],
      args,
      ctx,
      'FORBIDDEN',
    );
    expect(ctx.prisma.cycle.update).not.toHaveBeenCalled();
    expect(ctx.prisma.cycle.create).not.toHaveBeenCalled();
    expect(ctx.prisma.cycle.delete).not.toHaveBeenCalled();
  });
});

describe('cycleResolvers issue-scoped mutations honour guest scope', () => {
  const ISSUE_ID = '00000000-0000-0000-0000-000000000d01';
  const CYCLE = { ...ARCHIVED_CYCLE, archivedAt: null };
  const issueRow = (over: Record<string, unknown> = {}) => ({
    assigneeId: null,
    creatorId: '00000000-0000-0000-0000-0000000000aa',
    id: ISSUE_ID,
    organizationId: TEST_ORG.id,
    teamId: TEST_TEAM.id,
    ...over,
  });
  const calls = {
    cycleAddIssue: (c: CtxWithCycle) =>
      cycleResolvers.Mutation.cycleAddIssue(
        null,
        { cycleId: CYCLE.id, issueId: ISSUE_ID },
        c as never,
      ),
    cycleRemoveIssue: (c: CtxWithCycle) =>
      cycleResolvers.Mutation.cycleRemoveIssue(null, { issueId: ISSUE_ID }, c as never),
  };

  function setup(opts: { guest?: boolean; member?: boolean; issue?: Record<string, unknown> }) {
    const ctx = createCtx();
    ctx.prisma.cycle.findUnique.mockResolvedValue(CYCLE);
    ctx.prisma.issue.findUnique.mockResolvedValue(issueRow(opts.issue));
    ctx.prisma.issue.update.mockResolvedValue({});
    if (opts.member === false) {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);
    } else {
      memberOf(ctx);
    }
    ctx.prisma.teamMemberRole.findUnique.mockResolvedValue(
      opts.guest ? { role: 'guest' } : { role: 'member' },
    );
    return ctx;
  }

  describe.each(['cycleAddIssue', 'cycleRemoveIssue'] as const)('%s', name => {
    it('rejects a non-member', async () => {
      const ctx = setup({ member: false });
      await expect(calls[name](ctx)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
      expect(ctx.prisma.issue.update).not.toHaveBeenCalled();
    });

    it('rejects a guest for an issue they neither created nor are assigned to, leaking nothing', async () => {
      const ctx = setup({ guest: true });
      await expect(calls[name](ctx)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
      expect(ctx.prisma.issue.update).not.toHaveBeenCalled();
    });

    it('lets a guest act on an issue they created', async () => {
      const ctx = setup({ guest: true, issue: { creatorId: TEST_USER.id } });
      const result = await calls[name](ctx);
      expect(result.success).toBe(true);
      expect(ctx.prisma.issue.update).toHaveBeenCalled();
    });

    it('lets a guest act on an issue assigned to them', async () => {
      const ctx = setup({ guest: true, issue: { assigneeId: TEST_USER.id } });
      expect((await calls[name](ctx)).success).toBe(true);
    });

    it('lets a regular member act on any team issue', async () => {
      const ctx = setup({});
      expect((await calls[name](ctx)).success).toBe(true);
    });
  });

  it('cycleRollover lets a regular member through to the service', async () => {
    const ctx = setup({});
    const rollover = vi
      .spyOn(ctx.services.cycle, 'rollover')
      .mockResolvedValue({ movedCount: 0, movedIssueIds: [], nextCycleId: null });
    const result = await cycleResolvers.Mutation.cycleRollover(
      null,
      { cycleId: CYCLE.id },
      ctx as never,
    );
    expect(result.success).toBe(true);
    expect(rollover).toHaveBeenCalled();
  });

  it('cycleRollover rejects a non-member', async () => {
    const ctx = setup({ member: false });
    await expect(
      cycleResolvers.Mutation.cycleRollover(null, { cycleId: CYCLE.id }, ctx as never),
    ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });
});
