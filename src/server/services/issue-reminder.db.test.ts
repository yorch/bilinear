/**
 * Real-Postgres tests for issue reminders. The mocked tests in
 * `issue-reminder.service.test.ts` can only match SQL text; these run the
 * actual claim, so due/future selection, `LIMIT`, the workspace-membership join,
 * exactly-once under concurrency, bootstrap scoping and the per-user delta
 * filter are verified semantically.
 *
 * Opt in with a migrated scratch database:
 *   ISSUE_REMINDER_TEST_DB=postgresql://user:pass@localhost/scratch \
 *     yarn vitest run src/server/services/issue-reminder.db.test.ts
 * Skipped (not failed) when the variable is unset. Rows live under a throwaway
 * organization that is deleted afterwards.
 */

import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma';
import { getSyncVisibility } from '../lib/sync-visibility';
import { IssueReminderService } from './issue-reminder.service';
import { parseCursor, SyncService } from './sync.service';

const DB_URL = process.env.ISSUE_REMINDER_TEST_DB;
const HOUR = 3_600_000;

describe.skipIf(!DB_URL)('issue reminders against real Postgres', () => {
  let prisma: PrismaClient;
  let sync: SyncService;
  let service: IssueReminderService;
  let orgId: string;
  let teamId: string;
  let stateId: string;
  let alice: string;
  let bob: string;
  let n = 0;
  const userIds: string[] = [];

  async function user(label: string, member = true) {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        displayName: label,
        email: `${label}-${id}@example.test`,
        id,
        initials: 'T',
        name: label,
      },
    });
    userIds.push(id);
    if (member) {
      await prisma.organizationMember.create({ data: { organizationId: orgId, userId: id } });
    }
    return id;
  }

  async function issue(extra: { assigneeId?: string; creatorId?: string } = {}) {
    n += 1;
    return prisma.issue.create({
      data: {
        identifier: `REM-${n}`,
        number: n,
        organizationId: orgId,
        stateId,
        teamId,
        title: `Issue ${n}`,
        ...extra,
      },
    });
  }

  function reminder(userId: string, issueId: string, remindAt: Date) {
    return prisma.issueReminder.create({
      data: { issueId, organizationId: orgId, remindAt, userId },
    });
  }

  async function clean() {
    await prisma.issueReminder.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.syncAction.deleteMany({ where: { organizationId: orgId } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL as string }) });
    sync = new SyncService(prisma, { publish: async () => 1 } as unknown as Redis);
    service = new IssueReminderService(prisma, { sync });
    const suffix = randomUUID().slice(0, 8);
    const org = await prisma.organization.create({
      data: { name: `rem-${suffix}`, urlKey: `rem-${suffix}` },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: { displayName: 'Rem', key: 'REM', name: 'Rem', organizationId: orgId },
    });
    teamId = team.id;
    stateId = (
      await prisma.workflowState.create({
        data: { color: '#000', name: 'Todo', teamId, type: 'unstarted' },
      })
    ).id;
    alice = await user('alice');
    bob = await user('bob');
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.syncAction.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma?.$disconnect();
  });

  it('fires only due reminders (including one due exactly now) and leaves future ones', async () => {
    await clean();
    const i1 = await issue();
    const i2 = await issue();
    const i3 = await issue();
    const now = new Date();
    await reminder(alice, i1.id, new Date(now.getTime() - HOUR));
    await reminder(alice, i2.id, now);
    await reminder(alice, i3.id, new Date(now.getTime() + HOUR));

    const fired = await service.fireDue(now);

    expect(fired.map(f => f.issueId).sort()).toEqual([i1.id, i2.id].sort());
    expect(fired.every(f => f.notification?.type === 'REMINDER')).toBe(true);
    const left = await prisma.issueReminder.findMany({ where: { organizationId: orgId } });
    expect(left.map(r => r.issueId)).toEqual([i3.id]);
    expect(await prisma.notification.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it('fires a claimed reminder once: a second sweep finds nothing', async () => {
    await clean();
    await reminder(alice, (await issue()).id, new Date(Date.now() - HOUR));
    expect(await service.fireDue()).toHaveLength(1);
    expect(await service.fireDue()).toHaveLength(0);
    expect(await prisma.notification.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('respects the batch limit, oldest first', async () => {
    await clean();
    const now = new Date();
    const ids: string[] = [];
    for (let k = 0; k < 5; k++) {
      const i = await issue();
      ids.push(i.id);
      await reminder(alice, i.id, new Date(now.getTime() - (5 - k) * HOUR));
    }
    const fired = await service.fireDue(now, 2);
    expect(fired.map(f => f.issueId)).toEqual([ids[0], ids[1]]);
    expect(await prisma.issueReminder.count({ where: { organizationId: orgId } })).toBe(3);
  });

  it('sweep drains a backlog bigger than one batch, and a second concurrent sweep is a no-op', async () => {
    await clean();
    for (let k = 0; k < 7; k++) {
      await reminder(alice, (await issue()).id, new Date(Date.now() - HOUR));
    }
    const [a, b] = await Promise.all([service.sweep({ limit: 2 }), service.sweep({ limit: 2 })]);
    expect(a + b).toBe(7);
    expect(Math.min(a, b)).toBe(0); // re-entrancy guard
    expect(await prisma.issueReminder.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it('is exactly-once under concurrent sweeps', async () => {
    await clean();
    for (let k = 0; k < 30; k++) {
      await reminder(k % 2 ? alice : bob, (await issue()).id, new Date(Date.now() - HOUR));
    }
    const workers = Array.from({ length: 6 }, () => new IssueReminderService(prisma, { sync }));
    const results = await Promise.all(workers.map(w => w.fireDue(new Date(), 10)));
    const ids = results.flat().map(f => f.reminderId);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    expect(await prisma.notification.count({ where: { organizationId: orgId } })).toBe(30);
  });

  it('consumes a reminder whose owner left the workspace, without notifying', async () => {
    await clean();
    const leaver = await user('leaver', false);
    await reminder(leaver, (await issue()).id, new Date(Date.now() - HOUR));
    await reminder(alice, (await issue()).id, new Date(Date.now() - HOUR));

    const fired = await service.fireDue();

    expect(fired).toHaveLength(2);
    expect(fired.find(f => f.userId === leaver)?.notification).toBeNull();
    expect(fired.find(f => f.userId === alice)?.notification).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: leaver } })).toBe(0);
  });

  it('consumes without notifying when the issue is trashed or hidden from a guest', async () => {
    await clean();
    const guest = await user('guest');
    await prisma.teamMemberRole.create({ data: { role: 'guest', teamId, userId: guest } });
    const trashed = await issue();
    await prisma.issue.update({ data: { trashed: true }, where: { id: trashed.id } });
    const foreign = await issue({ creatorId: alice });
    const own = await issue({ assigneeId: guest });
    const past = new Date(Date.now() - HOUR);
    await reminder(guest, trashed.id, past);
    await reminder(guest, foreign.id, past);
    await reminder(guest, own.id, past);

    const fired = await service.fireDue();

    const delivered = fired.filter(f => f.notification).map(f => f.issueId);
    expect(fired).toHaveLength(3);
    expect(delivered).toEqual([own.id]);
    await prisma.teamMemberRole.deleteMany({ where: { teamId, userId: guest } });
  });

  it('bootstrap returns only the viewer own reminders, narrowed for guests', async () => {
    await clean();
    const guest = await user('guest2');
    await prisma.teamMemberRole.create({ data: { role: 'guest', teamId, userId: guest } });
    const foreign = await issue({ creatorId: alice });
    const own = await issue({ assigneeId: guest });
    const future = new Date(Date.now() + HOUR);
    await reminder(guest, foreign.id, future);
    await reminder(guest, own.id, future);
    await reminder(alice, foreign.id, future);

    const guestData = await sync.getBootstrapData(
      orgId,
      await getSyncVisibility(prisma, guest, orgId),
    );
    const aliceData = await sync.getBootstrapData(
      orgId,
      await getSyncVisibility(prisma, alice, orgId),
    );
    const bobData = await sync.getBootstrapData(orgId, await getSyncVisibility(prisma, bob, orgId));

    expect(guestData.issueReminders.map(r => r.issueId)).toEqual([own.id]);
    expect(aliceData.issueReminders.map(r => r.issueId)).toEqual([foreign.id]);
    expect(aliceData.issueReminders.every(r => r.userId === alice)).toBe(true);
    expect(bobData.issueReminders).toEqual([]);
    await prisma.teamMemberRole.deleteMany({ where: { teamId, userId: guest } });
  });

  it("another member's delta carries none of a user's reminder or its firing", async () => {
    await clean();
    const i = await issue();
    const { reminder: row } = await service.set(orgId, alice, i.id, new Date(Date.now() + HOUR));
    await sync.createSyncAction(orgId, 'I', 'IssueReminder', row.id, row);
    await prisma.issueReminder.update({
      data: { remindAt: new Date(Date.now() - HOUR) },
      where: { id: row.id },
    });
    await service.fireDue();

    const deltaFor = async (userId: string) =>
      (
        await sync.getDeltaSyncActions(
          orgId,
          parseCursor(null),
          undefined,
          500,
          await getSyncVisibility(prisma, userId, orgId),
        )
      ).actions.map(a => `${a.action} ${a.modelName}`);

    expect(await deltaFor(alice)).toEqual(['I IssueReminder', 'D IssueReminder', 'I Notification']);
    expect(await deltaFor(bob)).toEqual([]);
  });
});
