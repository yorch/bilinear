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
    it('upserts one row per (issue, user), re-arming firedAt', async () => {
      prisma.issue.findUnique.mockResolvedValue(ISSUE);
      prisma.issueReminder.upsert.mockResolvedValue({ id: 'r1' });
      const at = FUTURE();

      await service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, at);

      const arg = prisma.issueReminder.upsert.mock.calls[0]?.[0];
      expect(arg.where).toEqual({ issueId_userId: { issueId: ISSUE_ID, userId: TEST_USER.id } });
      expect(arg.update).toMatchObject({ firedAt: null, remindAt: at });
      expect(arg.create).toMatchObject({ organizationId: TEST_ORG.id, userId: TEST_USER.id });
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
      prisma.issueReminder.upsert.mockResolvedValue({ id: 'r1' });
      await expect(
        service.set(TEST_ORG.id, TEST_USER.id, ISSUE_ID, FUTURE()),
      ).resolves.toBeDefined();
    });
  });

  describe('clear', () => {
    it("only deletes the caller's own reminder in the caller's org", async () => {
      prisma.issueReminder.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.clear(TEST_ORG.id, TEST_USER.id, ISSUE_ID)).resolves.toBe(true);
      expect(prisma.issueReminder.deleteMany).toHaveBeenCalledWith({
        where: { issueId: ISSUE_ID, organizationId: TEST_ORG.id, userId: TEST_USER.id },
      });
    });

    it('is idempotent when nothing exists', async () => {
      prisma.issueReminder.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.clear(TEST_ORG.id, TEST_USER.id, ISSUE_ID)).resolves.toBe(false);
    });
  });

  describe('findPendingByUser', () => {
    it('scopes to the viewer, unfired, and visible live issues', async () => {
      visibility({ guestTeamIds: ['g1'], privateTeamIds: ['p1'] });
      prisma.issueReminder.findMany.mockResolvedValue([]);
      await service.findPendingByUser(TEST_ORG.id, TEST_USER.id);
      const where = prisma.issueReminder.findMany.mock.calls[0]?.[0].where;
      expect(where).toMatchObject({
        firedAt: null,
        organizationId: TEST_ORG.id,
        userId: TEST_USER.id,
      });
      expect(where.issue).toMatchObject({
        archivedAt: null,
        teamId: { notIn: ['p1'] },
        trashed: false,
      });
      expect(where.issue.OR).toContainEqual({ creatorId: TEST_USER.id });
    });
  });

  describe('fireDue', () => {
    const claimed = (over: Record<string, unknown> = {}) => ({
      id: 'rem-1',
      issue_id: ISSUE_ID,
      organization_id: TEST_ORG.id,
      remind_at: new Date('2026-11-24T09:00:00Z'),
      user_id: TEST_USER.id,
      ...over,
    });
    const issueRow = { ...ISSUE, id: ISSUE_ID };

    it('claims with an atomic UPDATE ... WHERE fired_at IS NULL RETURNING', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.fireDue();
      const strings = ((prisma.$queryRaw.mock.calls[0]?.[0] ?? []) as readonly string[]).join('?');
      expect(strings).toContain('UPDATE "issue_reminders"');
      expect(strings).toContain('"fired_at" IS NULL');
      expect(strings).toContain('FOR UPDATE SKIP LOCKED');
      expect(strings).toContain('RETURNING');
    });

    it('creates one REMINDER notification with {issueId, remindAt} and syncs it', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.create.mockResolvedValue({ id: 'n1', userId: TEST_USER.id });

      const out = await service.fireDue();

      expect(out).toHaveLength(1);
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create.mock.calls[0]?.[0].data).toEqual({
        data: { issueId: ISSUE_ID, remindAt: '2026-11-24T09:00:00.000Z' },
        issueId: ISSUE_ID,
        organizationId: TEST_ORG.id,
        type: 'REMINDER',
        userId: TEST_USER.id,
      });
      expect(sync.createSyncAction).toHaveBeenCalledWith(
        TEST_ORG.id,
        'I',
        'Notification',
        'n1',
        expect.objectContaining({ userId: TEST_USER.id }),
      );
    });

    it('fires nothing on a second sweep once the claim returns no rows', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([claimed()]).mockResolvedValueOnce([]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.create.mockResolvedValue({ id: 'n1', userId: TEST_USER.id });

      await service.fireDue();
      await service.fireDue();

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
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
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(sync.createSyncAction).not.toHaveBeenCalled();
    });

    it('does not notify when the owner lost access (now a private team non-member)', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      visibility({ privateTeamIds: [TEAM_ID] });

      await service.fireDue();

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('propagates a notification failure so the claim transaction rolls back', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.fireDue()).rejects.toThrow('db down');
      expect(sync.createSyncAction).not.toHaveBeenCalled();
    });

    it('survives a SyncAction failure (notification row is already committed)', async () => {
      prisma.$queryRaw.mockResolvedValue([claimed()]);
      prisma.issue.findMany.mockResolvedValue([issueRow]);
      prisma.notification.create.mockResolvedValue({ id: 'n1', userId: TEST_USER.id });
      sync.createSyncAction.mockRejectedValue(new Error('redis down'));

      await expect(service.fireDue()).resolves.toHaveLength(1);
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
