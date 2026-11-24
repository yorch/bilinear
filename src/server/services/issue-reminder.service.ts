import type { IssueReminder, Notification, Prisma, PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import {
  getSyncVisibility,
  getSyncVisibilityBatch,
  type SyncVisibility,
} from '../lib/sync-visibility';
import type { SyncService } from './sync.service';

const log = childLogger({ module: 'issue-reminder' });

/** A reminder must be at least this far ahead; guards clock skew, not intent. */
export const REMINDER_MIN_LEAD_MS = 0;
/** Reminders further out than this are rejected as absurd (one year). */
export const REMINDER_MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;
/** Max reminders claimed per batch, so one transaction stays short. */
export const REMINDER_SWEEP_BATCH = 200;
/** A sweep keeps claiming full batches until it has run this long, then yields to the next tick. */
export const REMINDER_SWEEP_BUDGET_MS = 20_000;
/** Interactive-transaction ceiling for one claim batch (Prisma's default 5 s is too tight under load). */
export const REMINDER_TX_TIMEOUT_MS = 30_000;

export class IssueReminderNotFoundError extends Error {
  constructor() {
    super('Issue not found');
    this.name = 'IssueReminderNotFoundError';
  }
}

export class IssueReminderInvalidTimeError extends Error {
  constructor(message = 'Reminder time must be a valid date in the future') {
    super(message);
    this.name = 'IssueReminderInvalidTimeError';
  }
}

export interface IssueReminderDeps {
  sync?: Pick<SyncService, 'createSyncAction'>;
}

export interface SweepOptions {
  /** Wall-clock budget; a full batch after it elapses is left for the next tick. */
  budgetMs?: number;
  limit?: number;
}

export interface FiredReminder {
  issueId: string;
  notification: Notification | null;
  orgId: string;
  remindAt: Date;
  reminderId: string;
  userId: string;
}

interface ClaimedRow {
  id: string;
  is_member: boolean;
  issue_id: string;
  organization_id: string;
  remind_at: Date;
  user_id: string;
}

/**
 * Whether `issue` may be seen under `visibility`: not in a private team the
 * viewer is outside of, and — on a team where the viewer is a guest — only
 * their own work. Same two rules the GraphQL layer and the sync paths apply.
 */
export function issueVisibleTo(
  issue: { assigneeId: string | null; creatorId: string | null; teamId: string },
  visibility: SyncVisibility,
): boolean {
  if (visibility.hiddenTeamIds.includes(issue.teamId)) {
    return false;
  }
  if (visibility.guestTeamIds.includes(issue.teamId)) {
    return issue.creatorId === visibility.userId || issue.assigneeId === visibility.userId;
  }
  return true;
}

/**
 * Per-user "remind me about this issue" reminders.
 *
 * One row per (issue, user): setting again moves the reminder. The table holds
 * only PENDING reminders: a fired reminder is deleted by the sweep.
 *
 * Reminders replicate like any entity (`I`/`U`/`D` SyncActions) but are
 * per-user rows: the payload carries `userId` and every sync path (delta, the
 * WebSocket fan-out, bootstrap) drops rows that are not the recipient's — see
 * `dropForeignUserRows`. The resolver emits the set/clear actions; the sweep
 * emits a `D` per fired reminder plus an `I Notification` when one is delivered.
 */
export class IssueReminderService {
  /** Re-entrancy guard for `sweep` — one drain at a time per instance. */
  private sweeping = false;

  constructor(
    private prisma: PrismaClient,
    private readonly deps: IssueReminderDeps = {},
  ) {}

  /** Parse and bound a client-supplied time. Throws IssueReminderInvalidTimeError. */
  static parseRemindAt(raw: string | Date, now: Date = new Date()): Date {
    const at = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(at.getTime())) {
      throw new IssueReminderInvalidTimeError();
    }
    if (at.getTime() <= now.getTime() + REMINDER_MIN_LEAD_MS) {
      throw new IssueReminderInvalidTimeError('Reminder time must be in the future');
    }
    if (at.getTime() > now.getTime() + REMINDER_MAX_HORIZON_MS) {
      throw new IssueReminderInvalidTimeError('Reminder time must be within one year');
    }
    return at;
  }

  /** `created` is false when an existing reminder was moved (the SyncAction is then a `U`). */
  async set(
    orgId: string,
    userId: string,
    issueId: string,
    remindAt: string | Date,
  ): Promise<{ created: boolean; reminder: IssueReminder }> {
    const at = IssueReminderService.parseRemindAt(remindAt);

    const issue = await this.prisma.issue.findUnique({
      select: {
        archivedAt: true,
        assigneeId: true,
        creatorId: true,
        organizationId: true,
        teamId: true,
        trashed: true,
      },
      where: { id: issueId },
    });
    // Hidden, foreign-org, trashed and archived issues are all "not found" so
    // the response never confirms an issue the viewer cannot see exists.
    if (!issue || issue.organizationId !== orgId || issue.trashed || issue.archivedAt) {
      throw new IssueReminderNotFoundError();
    }
    const visibility = await getSyncVisibility(this.prisma, userId, orgId);
    if (!issueVisibleTo(issue, visibility)) {
      throw new IssueReminderNotFoundError();
    }

    const existing = await this.prisma.issueReminder.findUnique({
      select: { id: true },
      where: { issueId_userId: { issueId, userId } },
    });
    const reminder = await this.prisma.issueReminder.upsert({
      create: { issueId, organizationId: orgId, remindAt: at, userId },
      update: { organizationId: orgId, remindAt: at },
      where: { issueId_userId: { issueId, userId } },
    });
    return { created: !existing, reminder };
  }

  /**
   * Remove the viewer's own reminder. Idempotent; returns the deleted row (for
   * the `D` SyncAction payload) or null when there was none.
   */
  async clear(orgId: string, userId: string, issueId: string): Promise<IssueReminder | null> {
    const existing = await this.prisma.issueReminder.findFirst({
      where: { issueId, organizationId: orgId, userId },
    });
    if (!existing) {
      return null;
    }
    await this.prisma.issueReminder.deleteMany({ where: { id: existing.id, userId } });
    return existing;
  }

  /**
   * Fire due reminders until none are left or the time budget is spent.
   * `fireDue` handles one bounded batch; a backlog bigger than one batch would
   * otherwise take one 30 s tick per 200 reminders. Re-entrant calls (a sweep
   * still running when the next tick lands) return 0 immediately.
   */
  async sweep({
    budgetMs = REMINDER_SWEEP_BUDGET_MS,
    limit = REMINDER_SWEEP_BATCH,
  }: SweepOptions = {}): Promise<number> {
    if (this.sweeping) {
      return 0;
    }
    this.sweeping = true;
    const startedAt = Date.now();
    let total = 0;
    try {
      for (;;) {
        const batch = await this.fireDue(new Date(), limit);
        total += batch.length;
        if (batch.length < limit || Date.now() - startedAt >= budgetMs) {
          break;
        }
      }
    } finally {
      this.sweeping = false;
    }
    return total;
  }

  /**
   * Fire up to `limit` due reminders exactly once.
   *
   * The claim is one `DELETE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
   * LOCKED) RETURNING`: workers running at the same instant take disjoint
   * rows, and a claimed row no longer exists to be claimed again. The
   * notifications are inserted in the same transaction (one `createMany`),
   * so a failure rolls the claim back and the next sweep retries instead of
   * losing the reminder. A reminder whose owner left the workspace, or whose
   * issue was trashed/archived or became invisible to its owner, is consumed
   * without a notification.
   *
   * After commit, a `D IssueReminder` per claimed row (so every open client of
   * the owner drops the chip) and an `I Notification` per delivery are emitted.
   */
  async fireDue(now: Date = new Date(), limit = REMINDER_SWEEP_BATCH): Promise<FiredReminder[]> {
    const fired = await this.prisma.$transaction(
      async tx => {
        const claimed = await tx.$queryRaw<ClaimedRow[]>`
          WITH due AS (
            SELECT "id" FROM "issue_reminders"
            WHERE "remind_at" <= ${now}
            ORDER BY "remind_at"
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM "issue_reminders" r
          USING due
          WHERE r."id" = due."id"
          RETURNING r."id", r."organization_id", r."issue_id", r."user_id", r."remind_at",
            EXISTS (
              SELECT 1 FROM "organization_members" m
              WHERE m."organization_id" = r."organization_id" AND m."user_id" = r."user_id"
            ) AS "is_member"`;
        if (claimed.length === 0) {
          return [];
        }
        claimed.sort((a, b) => a.remind_at.getTime() - b.remind_at.getTime());

        const issues = await tx.issue.findMany({
          select: {
            archivedAt: true,
            assigneeId: true,
            creatorId: true,
            id: true,
            teamId: true,
            trashed: true,
          },
          where: { id: { in: [...new Set(claimed.map(c => c.issue_id))] } },
        });
        const issueById = new Map(issues.map(i => [i.id, i]));

        // Visibility once per distinct (org, user) — two queries total.
        const pairs = new Map<string, { orgId: string; userId: string }>();
        for (const row of claimed) {
          if (row.is_member) {
            pairs.set(`${row.organization_id}:${row.user_id}`, {
              orgId: row.organization_id,
              userId: row.user_id,
            });
          }
        }
        const scopes = await getSyncVisibilityBatch(tx as unknown as PrismaClient, [
          ...pairs.values(),
        ]);
        const visibilityByKey = new Map<string, SyncVisibility>();
        [...pairs.keys()].forEach((key, i) => {
          visibilityByKey.set(key, scopes[i]);
        });

        const deliver = claimed.filter(row => {
          const issue = issueById.get(row.issue_id);
          const visibility = visibilityByKey.get(`${row.organization_id}:${row.user_id}`);
          return (
            row.is_member &&
            issue &&
            visibility &&
            !issue.trashed &&
            !issue.archivedAt &&
            issueVisibleTo(issue, visibility)
          );
        });
        const notifications =
          deliver.length > 0
            ? await tx.notification.createManyAndReturn({
                data: deliver.map(row => ({
                  data: {
                    issueId: row.issue_id,
                    remindAt: row.remind_at.toISOString(),
                  } as Prisma.InputJsonObject,
                  issueId: row.issue_id,
                  organizationId: row.organization_id,
                  type: 'REMINDER' as const,
                  userId: row.user_id,
                })),
              })
            : [];
        // createManyAndReturn preserves input order.
        const notificationByReminder = new Map<string, Notification>();
        deliver.forEach((row, i) => {
          notificationByReminder.set(row.id, notifications[i]);
        });

        return claimed.map(row => ({
          issueId: row.issue_id,
          notification: notificationByReminder.get(row.id) ?? null,
          orgId: row.organization_id,
          remindAt: row.remind_at,
          reminderId: row.id,
          userId: row.user_id,
        }));
      },
      { maxWait: 10_000, timeout: REMINDER_TX_TIMEOUT_MS },
    );

    // Tell the owner's open clients. Best effort: the rows are committed, so a
    // missed broadcast only delays the notification to the next delta sync, and
    // the chip already hides itself once its time has passed.
    const sync = this.deps.sync;
    if (sync) {
      for (const f of fired) {
        try {
          await sync.createSyncAction(f.orgId, 'D', 'IssueReminder', f.reminderId, {
            id: f.reminderId,
            issueId: f.issueId,
            organizationId: f.orgId,
            userId: f.userId,
          });
          if (f.notification) {
            await sync.createSyncAction(
              f.orgId,
              'I',
              'Notification',
              f.notification.id,
              f.notification,
            );
          }
        } catch (err) {
          log.error({ err, reminderId: f.reminderId }, 'Reminder SyncAction failed');
        }
      }
    }
    if (fired.length > 0) {
      log.info(
        { claimed: fired.length, delivered: fired.filter(f => f.notification).length },
        'Fired due issue reminders',
      );
    }
    return fired;
  }
}
