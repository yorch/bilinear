import type { Issue, IssueRelation, PrismaClient } from '../../generated/prisma';

/**
 * TriageService manages the inbound issue triage queue.
 *
 * Triage-enabled teams have a dedicated `triage` workflow state seeded at
 * team creation (see TeamService.seedDefaultStates). Issues created on a
 * triage-enabled team without an explicit state default to that triage
 * state and are surfaced in the team's triage queue until accepted,
 * declined, snoozed, or marked as duplicate.
 *
 * Lifecycle timestamps:
 *   - `startedTriageAt`: set when an issue first enters the triage state
 *   - `triagedAt`:       set when an issue exits triage (accept/decline/duplicate)
 *
 * Snoozing reuses the existing `snoozedUntilAt` field — the queue filter
 * hides snoozed issues until that timestamp has passed.
 */
export class TriageService {
  constructor(private prisma: PrismaClient) {}

  /** Find the triage workflow state for a team, or null if triage is disabled. */
  async findTriageState(teamId: string): Promise<{ id: string } | null> {
    return this.prisma.workflowState.findFirst({
      select: { id: true },
      where: { archivedAt: null, teamId, type: 'triage' },
    });
  }

  /**
   * Issues currently in the team's triage queue. Excludes snoozed-and-future
   * issues and any already-triaged issues. Ordered by createdAt ASC so the
   * oldest inbound work surfaces first.
   */
  async getQueue(teamId: string): Promise<Issue[]> {
    const triageState = await this.findTriageState(teamId);
    if (!triageState) {
      return [];
    }

    const now = new Date();
    return this.prisma.issue.findMany({
      include: { labelAssignments: { include: { label: true } } },
      orderBy: { createdAt: 'asc' },
      where: {
        archivedAt: null,
        OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: now } }],
        stateId: triageState.id,
        teamId,
        trashed: false,
      },
    });
  }

  /** Number of issues currently visible in a team's triage queue. */
  async getQueueCount(teamId: string): Promise<number> {
    const triageState = await this.findTriageState(teamId);
    if (!triageState) {
      return 0;
    }
    const now = new Date();
    return this.prisma.issue.count({
      where: {
        archivedAt: null,
        OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: now } }],
        stateId: triageState.id,
        teamId,
        trashed: false,
      },
    });
  }

  /**
   * Accept an issue out of triage by transitioning to a target state and
   * optionally setting assignee/priority/cycle. The target state is required
   * — typically the team's backlog or default state. Sets `triagedAt`.
   */
  async accept(
    issueId: string,
    input: {
      assigneeId?: string | null;
      cycleId?: string | null;
      priority?: number;
      stateId: string;
    },
  ): Promise<Issue> {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) {
      throw new TriageIssueNotFoundError();
    }
    const triageState = await this.findTriageState(issue.teamId);
    if (!triageState) {
      throw new TriageNotEnabledError();
    }
    if (triageState.id !== issue.stateId) {
      throw new TriageNotInQueueError();
    }

    // Target state must belong to the same team. Without this check a caller
    // could cross-team an issue by passing a stateId from another team/org.
    const targetState = await this.prisma.workflowState.findFirst({
      select: { id: true, teamId: true },
      where: { archivedAt: null, id: input.stateId },
    });
    if (!targetState || targetState.teamId !== issue.teamId) {
      throw new TriageInvalidTargetStateError();
    }

    const data: Parameters<PrismaClient['issue']['update']>[0]['data'] = {
      // Clear stale lifecycle markers in case the issue cycled back into
      // triage (e.g. someone manually re-routed it). These are set fresh
      // when the issue actually enters started/completed/canceled later.
      canceledAt: null,
      stateId: input.stateId,
      triagedAt: new Date(),
    };
    if ('assigneeId' in input) {
      // Validate the assignee is a member of the issue's team. Without
      // this an actor in team A could assign a triage issue to a user
      // who has no presence on that team, leaking who-is-where signals
      // across team boundaries.
      if (input.assigneeId) {
        const membership = await this.prisma.teamMembership.findUnique({
          select: { userId: true },
          where: {
            teamId_userId: { teamId: issue.teamId, userId: input.assigneeId },
          },
        });
        if (!membership) {
          throw new TriageInvalidAssigneeError();
        }
      }
      data.assigneeId = input.assigneeId;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
    }
    if ('cycleId' in input) {
      // Validate the cycle belongs to the same team. Mirrors the stateId
      // check above — caller-supplied references must respect team scope.
      if (input.cycleId) {
        const cycle = await this.prisma.cycle.findFirst({
          select: { id: true },
          where: { archivedAt: null, id: input.cycleId, teamId: issue.teamId },
        });
        if (!cycle) {
          throw new TriageInvalidCycleError();
        }
        data.addedToCycleAt = new Date();
      } else {
        // Mirror IssueService.update: clearing the cycle also clears the
        // join-timestamp so "added to cycle" filters don't show stale rows.
        data.addedToCycleAt = null;
      }
      data.cycleId = input.cycleId;
    }

    // Atomic CAS — only update if still in the triage state. Prevents two
    // concurrent accept/decline calls from both succeeding and emitting
    // conflicting SyncActions.
    const result = await this.prisma.issue.updateMany({
      data,
      where: { id: issueId, stateId: triageState.id },
    });
    if (result.count === 0) {
      throw new TriageNotInQueueError();
    }
    const updated = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!updated) {
      throw new TriageIssueNotFoundError();
    }
    return updated;
  }

  /**
   * Decline an issue from triage by canceling it. Moves to the team's
   * `canceled` workflow state and sets `canceledAt` and `triagedAt`.
   */
  async decline(issueId: string): Promise<Issue> {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) {
      throw new TriageIssueNotFoundError();
    }
    const triageState = await this.findTriageState(issue.teamId);
    if (!triageState) {
      throw new TriageNotEnabledError();
    }
    if (triageState.id !== issue.stateId) {
      throw new TriageNotInQueueError();
    }

    const canceledState = await this.prisma.workflowState.findFirst({
      orderBy: { position: 'asc' },
      select: { id: true },
      where: { archivedAt: null, teamId: issue.teamId, type: 'canceled' },
    });
    if (!canceledState) {
      throw new TriageMissingTargetStateError('canceled');
    }

    const now = new Date();
    // Atomic CAS — see accept() for rationale.
    const result = await this.prisma.issue.updateMany({
      data: {
        canceledAt: now,
        stateId: canceledState.id,
        triagedAt: now,
      },
      where: { id: issueId, stateId: triageState.id },
    });
    if (result.count === 0) {
      throw new TriageNotInQueueError();
    }
    const updated = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!updated) {
      throw new TriageIssueNotFoundError();
    }
    return updated;
  }

  /**
   * Mark an issue as a duplicate of another. Creates a `duplicate` IssueRelation
   * and cancels the duplicate (same flow as decline). Both issues must belong
   * to the same organization. Self-references are rejected.
   *
   * Returns both the updated issue and the relation row (when newly
   * created) so the resolver can emit a `'I' IssueRelation` SyncAction —
   * without that, other clients won't see the relation until a full
   * bootstrap. `relation` is null when the link already existed
   * (idempotent re-call).
   */
  async markDuplicate(
    issueId: string,
    canonicalIssueId: string,
  ): Promise<{ issue: Issue; relation: IssueRelation | null }> {
    if (issueId === canonicalIssueId) {
      throw new TriageDuplicateSelfError();
    }
    const [issue, canonical] = await Promise.all([
      this.prisma.issue.findUnique({ where: { id: issueId } }),
      this.prisma.issue.findUnique({ where: { id: canonicalIssueId } }),
    ]);
    if (!issue || !canonical) {
      throw new TriageIssueNotFoundError();
    }
    if (issue.organizationId !== canonical.organizationId) {
      throw new TriageCrossOrgError();
    }
    const triageState = await this.findTriageState(issue.teamId);
    if (!triageState) {
      throw new TriageNotEnabledError();
    }
    if (triageState.id !== issue.stateId) {
      throw new TriageNotInQueueError();
    }

    const canceledState = await this.prisma.workflowState.findFirst({
      orderBy: { position: 'asc' },
      select: { id: true },
      where: { archivedAt: null, teamId: issue.teamId, type: 'canceled' },
    });
    if (!canceledState) {
      throw new TriageMissingTargetStateError('canceled');
    }

    return this.prisma.$transaction(async tx => {
      // Capture whether a new relation row was created so the resolver
      // can decide whether to emit an `'I' IssueRelation` SyncAction.
      // skipDuplicates makes this idempotent at the DB level — concurrent
      // calls don't race because of the unique (issueId, relatedIssueId,
      // type) index.
      const before = await tx.issueRelation.findFirst({
        where: { issueId, relatedIssueId: canonicalIssueId, type: 'duplicate' },
      });
      let relation: IssueRelation | null = null;
      if (!before) {
        relation = await tx.issueRelation.create({
          data: { issueId, relatedIssueId: canonicalIssueId, type: 'duplicate' },
        });
      }
      const now = new Date();
      // Atomic CAS — only cancel if still in triage. Prevents racing with
      // concurrent decline / accept calls.
      const result = await tx.issue.updateMany({
        data: {
          canceledAt: now,
          stateId: canceledState.id,
          triagedAt: now,
        },
        where: { id: issueId, stateId: triageState.id },
      });
      if (result.count === 0) {
        throw new TriageNotInQueueError();
      }
      const updated = await tx.issue.findUnique({ where: { id: issueId } });
      if (!updated) {
        throw new TriageIssueNotFoundError();
      }
      return { issue: updated, relation };
    });
  }

  /**
   * Snooze an issue, hiding it from the triage queue until `until`. The issue
   * stays in the triage state — `triagedAt` is NOT set, since it hasn't been
   * resolved. `until` must be in the future.
   */
  async snooze(issueId: string, until: Date, snoozedById: string): Promise<Issue> {
    if (until <= new Date()) {
      throw new TriageSnoozeInvalidDateError();
    }
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) {
      throw new TriageIssueNotFoundError();
    }
    const triageState = await this.findTriageState(issue.teamId);
    if (!triageState) {
      throw new TriageNotEnabledError();
    }
    if (triageState.id !== issue.stateId) {
      throw new TriageNotInQueueError();
    }

    // Atomic CAS — see accept() for rationale. A concurrent accept/decline
    // could otherwise leave the just-resolved issue with a stale snooze.
    const result = await this.prisma.issue.updateMany({
      data: { snoozedById, snoozedUntilAt: until },
      where: { id: issueId, stateId: triageState.id },
    });
    if (result.count === 0) {
      throw new TriageNotInQueueError();
    }
    const updated = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!updated) {
      throw new TriageIssueNotFoundError();
    }
    return updated;
  }
}

export class TriageNotEnabledError extends Error {
  constructor() {
    super('Triage is not enabled for this team');
    this.name = 'TriageNotEnabledError';
  }
}

export class TriageInvalidTargetStateError extends Error {
  constructor() {
    super('Target workflow state must belong to the same team');
    this.name = 'TriageInvalidTargetStateError';
  }
}

export class TriageNotInQueueError extends Error {
  constructor() {
    super('Issue is not in the triage queue');
    this.name = 'TriageNotInQueueError';
  }
}

export class TriageIssueNotFoundError extends Error {
  constructor() {
    super('Issue not found');
    this.name = 'TriageIssueNotFoundError';
  }
}

export class TriageMissingTargetStateError extends Error {
  constructor(stateType: string) {
    super(`Team has no ${stateType} workflow state`);
    this.name = 'TriageMissingTargetStateError';
  }
}

export class TriageDuplicateSelfError extends Error {
  constructor() {
    super('Cannot mark an issue as a duplicate of itself');
    this.name = 'TriageDuplicateSelfError';
  }
}

export class TriageCrossOrgError extends Error {
  constructor() {
    super('Both issues must belong to the same organization');
    this.name = 'TriageCrossOrgError';
  }
}

export class TriageSnoozeInvalidDateError extends Error {
  constructor() {
    super('Snooze date must be in the future');
    this.name = 'TriageSnoozeInvalidDateError';
  }
}

export class TriageInvalidAssigneeError extends Error {
  constructor() {
    super("Assignee must be a member of the issue's team");
    this.name = 'TriageInvalidAssigneeError';
  }
}

export class TriageInvalidCycleError extends Error {
  constructor() {
    super('Cycle must belong to the same team as the issue');
    this.name = 'TriageInvalidCycleError';
  }
}
