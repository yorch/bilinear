import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  IssueReminderInvalidTimeError,
  IssueReminderNotFoundError,
  IssueReminderService,
  issueVisibleTo,
  REMINDER_MAX_HORIZON_MS,
} from './issue-reminder.service';

const ISSUE_ID = '00000000-0000-0000-0000-000000000400';
const TEAM_ID = '00000000-0000-0000-0000-000000000300';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000ff';
const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);

const ISSUE = {
  archivedAt: null,
  assigneeId: null,
  creatorId: null,
  organizationId: TEST_ORG.id,
  teamId: TEAM_ID,
  trashed: false,
};

describe('IssueReminderService', () => {
  let prisma: MockPrismaClient;
  let service: IssueReminderService;
  const sync = { createSyncAction: vi.fn() };
  const claimedRow = (over: Record<string, unknown> = {}) => ({
    id: 'rem-1',
    is_member: true,
    issue_id: ISSUE_ID,
    organization_id: TEST_ORG.id,
    remind_at: new Date('2026-11-24T09:00:00Z'),
    user_id: TEST_USER.id,
    ...over,
  });

  /** Visibility inputs: private teams (with the viewer's membership) + guest roles. */
  function visibility(opts: { privateTeamIds?: string[]; guestTeamIds?: string[] } = {}) {
    prisma.team.findMany.mockResolvedValue(
      (opts.privateTeamIds ?? []).map(id => ({
        id,
        memberships: [],
        organizationId: TEST_ORG.id,
      })),
    );
    prisma.teamMemberRole.findMany.mockResolvedValue(
      (opts.guestTeamIds ?? []).map(teamId => ({
        team: { organizationId: TEST_ORG.id },
        teamId,
        userId: TEST_USER.id,
      })),
    );
  }

  beforeEach(() => {
    prisma = createMockPrisma();
    sync.createSyncAction.mockReset();
    service = new IssueReminderService(prisma as never, { sync });
    visibility();
  });

  describe('parseRemindAt', () => {
    it('rejects past, present and unparseable times', () => {
      const now = new Date('2026-11-24T12:00:00Z');
      expect(() => IssueReminderService.parseRemindAt('2026-11-24T11:00:00Z', now)).toThrow(
        IssueReminderInvalidTimeError,
      );
      expect(() => IssueReminderService.parseRemindAt(now, now)).toThrow(
        IssueReminderInvalidTimeError,
      );
      expect(() => IssueReminderService.parseRemindAt('not a date', now)).toThrow(
        IssueReminderInvalidTimeError,
      );
    });

    it('rejects times beyond the one-year horizon but accepts the edge', () => {
      const now = new Date('2026-11-24T12:00:00Z');
      const edge = new Date(now.getTime() + REMINDER_MAX_HORIZON_MS);
      expect(IssueReminderService.parseRemindAt(edge, now)).toEqual(edge);
      expect(() => IssueReminderService.parseRemindAt(new Date(edge.getTime() + 1), now)).toThrow(
        IssueReminderInvalidTimeError,
      );
    });
  });

  describe('set', () => {
    it('upserts one row per (issue, user)', async () => {
      prisma.issue.findUnique.mockResolvedValue(ISSUE);
      prisma.issueReminder.findUnique.mockResolvedValue(null);
      prisma.issueReminder.upsert.mockResolvedValue({ id: 'r1' });
      const at = FUTURE();

      const out = await service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, at);

      const arg = prisma.issueReminder.upsert.mock.calls[0]?.[0];
      expect(arg.where).toEqual({ issueId_userId: { issueId: ISSUE_ID, userId: TEST_USER.id } });
      expect(arg.update).toMatchObject({ remindAt: at });
      expect(arg.create).toMatchObject({ organizationId: TEST_ORG.id, userId: TEST_USER.id });
      expect(out.created).toBe(true);
    });

    it('reports a moved reminder as an update, not a create', async () => {
      prisma.issue.findUnique.mockResolvedValue(ISSUE);
      prisma.issueReminder.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.issueReminder.upsert.mockResolvedValue({ id: 'r1' });
      const out = await service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, FUTURE());
      expect(out.created).toBe(false);
    });

    it('does not touch the DB for a past time', async () => {
      await expect(
        service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, new Date(Date.now() - 1000)),
      ).rejects.toBeInstanceOf(IssueReminderInvalidTimeError);
      expect(prisma.issue.findUnique).not.toHaveBeenCalled();
      expect(prisma.issueReminder.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', null],
      ['another organization', { ...ISSUE, organizationId: OTHER_ORG }],
      ['trashed', { ...ISSUE, trashed: true }],
      ['archived', { ...ISSUE, archivedAt: new Date() }],
    ])('treats a %s issue as not found', async (_label, issue) => {
      prisma.issue.findUnique.mockResolvedValue(issue);
      await expect(
        service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, FUTURE()),
      ).rejects.toBeInstanceOf(IssueReminderNotFoundError);
      expect(prisma.issueReminder.upsert).not.toHaveBeenCalled();
    });

    it('treats an issue in a private team the viewer is not in as not found', async () => {
      prisma.issue.findUnique.mockResolvedValue(ISSUE);
      visibility({ privateTeamIds: [TEAM_ID] });
      await expect(
        service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, FUTURE()),
      ).rejects.toBeInstanceOf(IssueReminderNotFoundError);
      expect(prisma.issueReminder.upsert).not.toHaveBeenCalled();
    });

    it('lets a guest remind only on their own work', async () => {
      visibility({ guestTeamIds: [TEAM_ID] });
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE, creatorId: 'someone-else' });
      await expect(
        service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, FUTURE()),
      ).rejects.toBeInstanceOf(IssueReminderNotFoundError);

      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE, assigneeId: TEST_USER.id });
      prisma.issueReminder.findUnique.mockResolvedValue(null);
      prisma.issueReminder.upsert.mockResolvedValue({ id: 'r1' });
      await expect(
        service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, FUTURE()),
      ).resolves.toBeDefined();
    });
  });

  describe('clear', () => {
    it("only deletes the caller's own reminder in the caller's org, and returns it", async () => {
      const row = { id: 'r1', userId: TEST_USER.id };
      prisma.issueReminder.findFirst.mockResolvedValue(row);
      prisma.issueReminder.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.clear(TEST_ORG.id, TEST_USER.id, ISSUE_ID)).resolves.toBe(row);
      expect(prisma.issueReminder.findFirst).toHaveBeenCalledWith({
        where: { issueId: ISSUE_ID, organizationId: TEST_ORG.id, userId: TEST_USER.id },
      });
      expect(prisma.issueReminder.deleteMany).toHaveBeenCalledWith({
        where: { id: 'r1', userId: TEST_USER.id },
      });
    });

    it('is idempotent when nothing exists', async () => {
      prisma.issueReminder.findFirst.mockResolvedValue(null);
      await expect(service.clear(TEST_ORG.id, TEST_USER.id, ISSUE_ID)).resolves.toBeNull();
      expect(prisma.issueReminder.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('fireDue', () => {
    const claimed = claimedRow;
    const issueRow = { ...ISSUE, id: ISSUE_ID };

    it('claims with an atomic DELETE ... FOR UPDATE SKIP LOCKED ... RETURNING', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.fireDue();
      const strings = ((prisma.$queryRaw.mock.calls[0]?.[0] ?? []) as readonly string[]).join('?');
      expect(strings).toContain('DELETE FROM "issue_reminders"');
      expect(strings).toContain('"remind_at" <=');
      expect(strings).toContain('LIMIT');
      expect(strings).toContain('FOR UPDATE SKIP LOCKED');
      expect(strings).toContain('RETURNING');
      expect(strings).toContain('"organization_members"');
    });

    it('runs the claim in one transaction with an explicit timeout above the 5 s default', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.fireDue();
      const opts = prisma.$transaction.mock.calls[0]?.[1] as { timeout: number };
      expect(opts.timeout).toBeGreaterThanOrEqual(15_000);
    });

    it('creates the REMINDER notifications in ONE createManyAndReturn and syncs delete + notification', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.createManyAndReturn.mockResolvedValue([
        { id: 'n1', userId: TEST_USER.id },
      ]);

      const out = await service.fireDue();

      expect(out).toHaveLength(1);
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(prisma.notification.createManyAndReturn.mock.calls[0]?.[0].data).toEqual([
        {
          data: { issueId: ISSUE_ID, remindAt: '2026-11-24T09:00:00.000Z' },
          issueId: ISSUE_ID,
          organizationId: TEST_ORG.id,
          type: 'REMINDER',
          userId: TEST_USER.id,
        },
      ]);
      expect(sync.createSyncAction).toHaveBeenCalledWith(
        TEST_ORG.id,
        'D',
        'IssueReminder',
        'rem-1',
        expect.objectContaining({ id: 'rem-1', issueId: ISSUE_ID, userId: TEST_USER.id }),
      );
      expect(sync.createSyncAction).toHaveBeenCalledWith(
        TEST_ORG.id,
        'I',
        'Notification',
        'n1',
        expect.objectContaining({ userId: TEST_USER.id }),
      );
    });

    it('batches 200 reminders for 3 users into one insert and two visibility queries', async () => {
      const users = ['u1', 'u2', 'u3'];
      const rows = Array.from({ length: 200 }, (_, i) =>
        claimed({ id: `rem-${i}`, user_id: users[i % 3] }),
      );
      prisma.$queryRaw.mockResolvedValue(rows);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.createManyAndReturn.mockImplementation(
        async ({ data }: { data: unknown[] }) => data.map((_, i) => ({ id: `n${i}`, userId: 'x' })),
      );

      const out = await service.fireDue();

      expect(out).toHaveLength(200);
      expect(prisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(prisma.team.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.teamMemberRole.findMany).toHaveBeenCalledTimes(1);
    });

    it('still reports every claimed reminder when one batch is processed', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([claimed()]).mockResolvedValueOnce([]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.createManyAndReturn.mockResolvedValue([
        { id: 'n1', userId: TEST_USER.id },
      ]);

      await service.fireDue();
      await service.fireDue();

      expect(prisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['trashed', { ...issueRow, trashed: true }],
      ['archived', { ...issueRow, archivedAt: new Date() }],
      ['deleted', null],
    ])('consumes the reminder without notifying for a %s issue', async (_l, issue) => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue(issue ? [issue] : []);

      const out = await service.fireDue();

      expect(out[0]?.notification).toBeNull();
      expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
      // The chip still has to go away.
      expect(sync.createSyncAction).toHaveBeenCalledWith(
        TEST_ORG.id,
        'D',
        'IssueReminder',
        'rem-1',
        expect.anything(),
      );
      expect(sync.createSyncAction).not.toHaveBeenCalledWith(
        expect.anything(),
        'I',
        'Notification',
        expect.anything(),
        expect.anything(),
      );
    });

    it('consumes without notifying when the owner is no longer a workspace member', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed({ is_member: false })]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);

      const out = await service.fireDue();

      expect(out[0]?.notification).toBeNull();
      expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('does not notify when the owner lost access (now a private team non-member)', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      visibility({ privateTeamIds: [TEAM_ID] });

      await service.fireDue();

      expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('propagates a notification failure so the claim transaction rolls back', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.createManyAndReturn.mockRejectedValue(new Error('db down'));

      await expect(service.fireDue()).rejects.toThrow('db down');
      expect(sync.createSyncAction).not.toHaveBeenCalled();
    });

    it('survives a SyncAction failure (rows are already committed)', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.createManyAndReturn.mockResolvedValue([
        { id: 'n1', userId: TEST_USER.id },
      ]);
      sync.createSyncAction.mockRejectedValue(new Error('redis down'));

      await expect(service.fireDue()).resolves.toHaveLength(1);
    });
  });

  describe('sweep', () => {
    it('keeps claiming while batches come back full, then stops on a short one', async () => {
      const spy = vi
        .spyOn(service, 'fireDue')
        .mockResolvedValueOnce(Array(3).fill({}) as never)
        .mockResolvedValueOnce(Array(3).fill({}) as never)
        .mockResolvedValueOnce(Array(1).fill({}) as never);
      await expect(service.sweep({ limit: 3 })).resolves.toBe(7);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('stops at the time budget even if batches stay full', async () => {
      vi.useFakeTimers();
      try {
        const spy = vi.spyOn(service, 'fireDue').mockImplementation(async () => {
          vi.advanceTimersByTime(6_000);
          return Array(2).fill({}) as never;
        });
        await expect(service.sweep({ budgetMs: 10_000, limit: 2 })).resolves.toBe(4);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores a re-entrant call while a sweep is running, and recovers after a failure', async () => {
      let release: () => void = () => undefined;
      const spy = vi.spyOn(service, 'fireDue').mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = () => resolve([] as never);
          }),
      );
      const first = service.sweep();
      await expect(service.sweep()).resolves.toBe(0);
      release();
      await first;
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRejectedValueOnce(new Error('boom'));
      await expect(service.sweep()).rejects.toThrow('boom');
      spy.mockResolvedValueOnce([] as never);
      await expect(service.sweep()).resolves.toBe(0);
    });
  });

  describe('issueVisibleTo', () => {
    const vis = { guestTeamIds: ['g'], hiddenTeamIds: ['h'], userId: 'u' };
    it('applies hidden and guest rules', () => {
      expect(issueVisibleTo({ assigneeId: null, creatorId: null, teamId: 'h' }, vis)).toBe(false);
      expect(issueVisibleTo({ assigneeId: null, creatorId: null, teamId: 'g' }, vis)).toBe(false);
      expect(issueVisibleTo({ assigneeId: 'u', creatorId: null, teamId: 'g' }, vis)).toBe(true);
      expect(issueVisibleTo({ assigneeId: null, creatorId: null, teamId: 'x' }, vis)).toBe(true);
    });
  });
});
