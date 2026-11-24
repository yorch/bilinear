import type { IssueReminder, Notification, Prisma, PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import { getSyncVisibility, type SyncVisibility } from '../lib/sync-visibility';
import type { SyncService } from './sync.service';

const log = childLogger({ module: 'issue-reminder' });

/** A reminder must be at least this far ahead; guards clock skew, not intent. */
export const REMINDER_MIN_LEAD_MS = 0;
/** Reminders further out than this are rejected as absurd (one year). */
export const REMINDER_MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;
/** Max reminders claimed per sweep, so one tick cannot hold a transaction open for long. */
export const REMINDER_SWEEP_BATCH = 200;

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

export interface FiredReminder {
  issueId: string;
  notification: Notification | null;
  orgId: string;
  reminderId: string;
  userId: string;
}

interface ClaimedRow {
  id: string;
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
 * One row per (issue, user): setting again moves the reminder and re-arms it.
 * Reminders are deliberately NOT replicated through SyncActions — those
 * broadcast org-wide, and a reminder is private to its owner — so the client
 * reads them through the `myIssueReminders` query instead. What *is* synced is
 * the `Notification` the sweep produces when one fires.
 */
export class IssueReminderService {
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

  async set(
    orgId: string,
    userId: string,
    issueId: string,
    remindAt: string | Date,
  ): Promise<IssueReminder> {
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

    return this.prisma.issueReminder.upsert({
      create: { issueId, organizationId: orgId, remindAt: at, userId },
      update: { firedAt: null, organizationId: orgId, remindAt: at },
      where: { issueId_userId: { issueId, userId } },
    });
  }

  /** Remove the viewer's own reminder. Idempotent; returns whether a row existed. */
  async clear(orgId: string, userId: string, issueId: string): Promise<boolean> {
    const res = await this.prisma.issueReminder.deleteMany({
      where: { issueId, organizationId: orgId, userId },
    });
    return res.count > 0;
  }

  /** The viewer's pending (unfired) reminders on issues they can still see. */
  async findPendingByUser(orgId: string, userId: string): Promise<IssueReminder[]> {
    const visibility = await getSyncVisibility(this.prisma, userId, orgId);
    return this.prisma.issueReminder.findMany({
      orderBy: { remindAt: 'asc' },
      where: {
        firedAt: null,
        issue: {
          archivedAt: null,
          trashed: false,
          ...(visibility.hiddenTeamIds.length > 0
            ? { teamId: { notIn: visibility.hiddenTeamIds } }
            : {}),
          ...(visibility.guestTeamIds.length > 0
            ? {
                OR: [
                  { teamId: { notIn: visibility.guestTeamIds } },
                  { creatorId: userId },
                  { assigneeId: userId },
                ],
              }
            : {}),
        },
        organizationId: orgId,
        userId,
      },
    });
  }

  /**
   * Fire every due reminder exactly once.
   *
   * The claim is a single `UPDATE ... WHERE fired_at IS NULL ... RETURNING`
   * over a `FOR UPDATE SKIP LOCKED` batch: two workers running the sweep at
   * the same instant take disjoint rows, and a row already claimed is never
   * returned again. The notifications are written in the same transaction, so
   * a failure rolls the claim back and the next sweep retries instead of
   * losing the reminder. A claimed reminder whose issue was trashed/archived
   * or became invisible to its owner is consumed without a notification.
   */
  async fireDue(now: Date = new Date(), limit = REMINDER_SWEEP_BATCH): Promise<FiredReminder[]> {
    const fired = await this.prisma.$transaction(async tx => {
      const claimed = await tx.$queryRaw<ClaimedRow[]>`
        UPDATE "issue_reminders"
        SET "fired_at" = ${now}, "updated_at" = ${now}
        WHERE "id" IN (
          SELECT "id" FROM "issue_reminders"
          WHERE "fired_at" IS NULL AND "remind_at" <= ${now}
          ORDER BY "remind_at"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ) AND "fired_at" IS NULL
        RETURNING "id", "organization_id", "issue_id", "user_id", "remind_at"`;
      if (claimed.length === 0) {
        return [];
      }

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

      const visibilityByKey = new Map<string, SyncVisibility>();
      const results: FiredReminder[] = [];
      for (const row of claimed) {
        const issue = issueById.get(row.issue_id);
        let notification: Notification | null = null;
        if (issue && !issue.trashed && !issue.archivedAt) {
          const key = `${row.organization_id}:${row.user_id}`;
          let visibility = visibilityByKey.get(key);
          if (!visibility) {
            visibility = await getSyncVisibility(
              tx as unknown as PrismaClient,
              row.user_id,
              row.organization_id,
            );
            visibilityByKey.set(key, visibility);
          }
          if (issueVisibleTo(issue, visibility)) {
            notification = await tx.notification.create({
              data: {
                data: {
                  issueId: row.issue_id,
                  remindAt: row.remind_at.toISOString(),
                } as Prisma.InputJsonObject,
                issueId: row.issue_id,
                organizationId: row.organization_id,
                type: 'REMINDER',
                userId: row.user_id,
              },
            });
          }
        }
        results.push({
          issueId: row.issue_id,
          notification,
          orgId: row.organization_id,
          reminderId: row.id,
          userId: row.user_id,
        });
      }
      return results;
    });

    // Fan the new notifications out to the owner's open clients. Best effort:
    // the row is committed, so a missed broadcast only delays it to the next
    // delta sync.
    const sync = this.deps.sync;
    if (sync) {
      for (const f of fired) {
        if (!f.notification) {
          continue;
        }
        try {
          await sync.createSyncAction(
            f.orgId,
            'I',
            'Notification',
            f.notification.id,
            f.notification,
          );
        } catch (err) {
          log.error({ err, notificationId: f.notification.id }, 'Reminder SyncAction failed');
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
