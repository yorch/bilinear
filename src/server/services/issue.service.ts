import type { Issue, IssueLabel, IssueReaction, PrismaClient } from '../../generated/prisma';
import type { SyncWriteClient } from './sync.service';

type PrismaLike = Pick<PrismaClient, 'issue' | 'issueLabelAssignment' | 'issueLabel' | 'team'>;

/**
 * In-transaction hook invoked just before `create`/`update` return, while the
 * business-write transaction is still open. Lets the resolver persist the
 * SyncAction atomically with the issue write (via `sync.recordSyncAction(tx,
 * …)`) so a crash can never leave a row without its replication marker. The
 * resolver publishes the recorded action(s) to Redis AFTER the call resolves.
 */
export type IssueCreateTxHook = (tx: SyncWriteClient, issue: Issue) => Promise<void>;
export type IssueUpdateTxHook = (
  tx: SyncWriteClient,
  result: { issue: Issue; cascaded: Issue[] },
) => Promise<void>;
/**
 * Hook for single-row issue mutations (archive/unarchive/snooze/unsnooze/
 * delete). Receives the post-write row (for delete, the row as it was just
 * before removal) so the resolver can record the SyncAction inside the same
 * transaction. Publish happens after commit.
 */
export type IssueRowTxHook = (tx: SyncWriteClient, issue: Issue) => Promise<void>;
/** Hook for reaction add/remove — receives the affected reaction row id. */
export type IssueReactionTxHook = (
  tx: SyncWriteClient,
  reaction: { id: string } & Record<string, unknown>,
) => Promise<void>;
/** Hook for bulk update — receives every updated row, in input order. */
export type IssuesBulkTxHook = (tx: SyncWriteClient, issues: Issue[]) => Promise<void>;

export interface IssueCreateInput {
  assigneeId?: string;
  cycleId?: string;
  description?: string;
  dueDate?: string; // ISO date string YYYY-MM-DD
  estimate?: number;
  id?: string;
  labelIds?: string[];
  parentId?: string;
  priority?: number;
  projectId?: string;
  projectMilestoneId?: string;
  sortOrder?: number;
  startDate?: string; // ISO date string YYYY-MM-DD
  stateId?: string;
  teamId: string;
  title: string;
}

export interface IssueUpdateInput {
  assigneeId?: string | null;
  cycleId?: string | null;
  description?: string;
  dueDate?: string | null;
  estimate?: number | null;
  labelIds?: string[];
  parentId?: string | null;
  priority?: number;
  prioritySortOrder?: number;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  sortOrder?: number;
  startDate?: string | null;
  stateId?: string;
  title?: string;
  trashed?: boolean;
}

export interface IssueFilter {
  assigneeId?: string | null;
  /**
   * Guest visibility scope. When set, the query is restricted to issues
   * the guest created OR is assigned to. The resolver layer derives this
   * from the caller's team_member_roles row; never set by the client.
   */
  guestUserId?: string;
  includeArchived?: boolean;
  /**
   * When false (default), snoozed issues that haven't woken up yet are
   * hidden from the result set — wakeup is computed at read-time as
   * `snoozedUntilAt IS NULL OR snoozedUntilAt <= now()`. Set true to
   * include snoozed issues (used by the "snoozed" view).
   */
  includeSnoozed?: boolean;
  priority?: number;
  stateId?: string;
  teamId?: string;
  trashed?: boolean;
}

// List-view queries omit the descriptionState YJS blob (see findMany/
// findByTeamId). Callers that need to render/edit the rich description
// re-fetch via findById / findByIdentifier.
export type IssueListRow = Omit<Issue, 'descriptionState'>;

// Server-side input caps. Title/description mirror the column width (title
// is VarChar(1000) in the DB; 512 is a tighter app-level guard) and a
// generous-but-bounded description/comment-body size so a malicious or
// buggy client can't push multi-megabyte payloads through the mutation
// path. Priority is clamped to the app's 0(none)-4(low) scale (see
// import.service.ts's PRIORITY_BY_NAME for the same range).
const MAX_TITLE_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 100_000;
const MIN_PRIORITY = 0;
const MAX_PRIORITY = 4;

function assertValidTitle(title: string | undefined): void {
  if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
    throw new IssueValidationError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }
}

function assertValidDescription(description: string | undefined): void {
  if (description !== undefined && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new IssueValidationError(
      `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    );
  }
}

function assertValidPriority(priority: number | undefined): void {
  if (
    priority !== undefined &&
    (!Number.isInteger(priority) || priority < MIN_PRIORITY || priority > MAX_PRIORITY)
  ) {
    throw new IssueValidationError(
      `priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`,
    );
  }
}

/**
 * References supplied on create/update/bulkUpdate that point at another
 * entity by id (parent issue, project, cycle, milestone, assignee). Every
 * one of these was previously written unvalidated — only `stateId` was
 * checked against the team. A member of team A could set an issue's
 * parentId/projectId/cycleId/projectMilestoneId to another ORG's row id
 * (cross-tenant injection) or assign an issue to a user with no
 * relationship to the org at all. `validateReferences` closes that hole.
 */
interface IssueReferenceInput {
  assigneeId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
}

export interface IssuePage {
  nodes: IssueListRow[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount: number;
}

export class IssueService {
  constructor(private prisma: PrismaClient) {}

  async create(
    orgId: string,
    creatorId: string,
    input: IssueCreateInput,
    txHook?: IssueCreateTxHook,
  ): Promise<Issue> {
    assertValidTitle(input.title);
    assertValidDescription(input.description);
    assertValidPriority(input.priority);

    return this.prisma.$transaction(async tx => {
      // Atomically increment issueCount and use it as the issue number
      const team = await tx.team.update({
        data: { issueCount: { increment: 1 } },
        where: { id: input.teamId },
      });
      const number = team.issueCount;
      const identifier = `${team.key}-${number}`;

      // Caller-supplied stateId must belong to the same team — otherwise
      // a member of team A could create an issue in team A but with team
      // B's workflow state, breaking team isolation. Mirrors the same
      // check the triage service applies on accept.
      if (input.stateId) {
        const state = await tx.workflowState.findFirst({
          select: { teamId: true },
          where: { archivedAt: null, id: input.stateId },
        });
        if (!state || state.teamId !== input.teamId) {
          throw new IssueInvalidStateError();
        }
      }

      // Triage routing: issues created on a triage-enabled team without an
      // explicit stateId go to the team's triage state, not the default. The
      // triage state was seeded at team creation (see TeamService) and lives
      // ahead of the default backlog state in `position`.
      let triageStateId: string | null = null;
      if (!input.stateId && team.triageEnabled) {
        const triageState = await tx.workflowState.findFirst({
          select: { id: true },
          where: { archivedAt: null, teamId: input.teamId, type: 'triage' },
        });
        triageStateId = triageState?.id ?? null;
      }

      // If no stateId supplied, fall back to triage (if applicable) then to
      // the team's defaultIssueStateId.
      const stateId = input.stateId ?? triageStateId ?? team.defaultIssueStateId;
      if (!stateId) {
        throw new IssueStateRequiredError();
      }
      const enteringTriage = stateId === triageStateId;

      // Property inheritance: a child created from a parent inherits the
      // parent's project and cycle when the caller does not supply them.
      // Keeps parent/child work grouped by default without forcing a
      // policy (caller can still pass explicit values to opt out).
      let inheritedProjectId = input.projectId;
      let inheritedProjectMilestoneId = input.projectMilestoneId;
      let inheritedCycleId = input.cycleId;
      if (input.parentId) {
        const parent = await tx.issue.findUnique({
          select: {
            cycleId: true,
            organizationId: true,
            projectId: true,
            projectMilestoneId: true,
          },
          where: { id: input.parentId },
        });
        // A parentId must resolve to an issue in the SAME org — otherwise a
        // caller could point a new issue's parentId at another org's issue
        // (cross-tenant reference injection) and, as a side effect, inherit
        // that org's project/cycle/milestone onto this issue.
        if (!parent || parent.organizationId !== orgId) {
          throw new IssueInvalidReferenceError('parentId');
        }
        if (inheritedProjectId === undefined) {
          inheritedProjectId = parent.projectId ?? undefined;
        }
        if (
          inheritedProjectMilestoneId === undefined &&
          // Only inherit the milestone if we're also on the parent's project
          inheritedProjectId === parent.projectId
        ) {
          inheritedProjectMilestoneId = parent.projectMilestoneId ?? undefined;
        }
        if (inheritedCycleId === undefined) {
          inheritedCycleId = parent.cycleId ?? undefined;
        }
      }

      // Validate every other cross-entity reference (post-inheritance, so
      // inherited values are checked too) belongs to this org — and, for
      // cycleId, to this issue's team.
      await this.validateReferences(tx, orgId, [input.teamId], {
        assigneeId: input.assigneeId,
        cycleId: inheritedCycleId,
        projectId: inheritedProjectId,
        projectMilestoneId: inheritedProjectMilestoneId,
      });

      const issue = await tx.issue.create({
        data: {
          addedToCycleAt: inheritedCycleId ? new Date() : undefined,
          addedToProjectAt: inheritedProjectId ? new Date() : undefined,
          assigneeId: input.assigneeId,
          creatorId,
          cycleId: inheritedCycleId,
          description: input.description,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          estimate: input.estimate,
          id: input.id ?? undefined,
          identifier,
          number,
          organizationId: orgId,
          parentId: input.parentId,
          priority: input.priority ?? 0,
          projectId: inheritedProjectId,
          projectMilestoneId: inheritedProjectMilestoneId,
          sortOrder: input.sortOrder ?? 0,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          startedTriageAt: enteringTriage ? new Date() : undefined,
          stateId,
          teamId: input.teamId,
          title: input.title,
        },
      });

      if (input.labelIds?.length) {
        await this.syncLabels(tx, issue.id, orgId, input.labelIds);
      }

      // Persist the SyncAction inside this transaction (atomic with the issue
      // write). Publish happens in the resolver after commit.
      await txHook?.(tx, issue);

      return issue;
    });
  }

  async findById(id: string): Promise<Issue | null> {
    return this.prisma.issue.findUnique({
      include: { labelAssignments: { include: { label: true } } },
      where: { id },
    });
  }

  /**
   * Team keys are unique only within an org (and only among non-archived
   * teams). Without `organizationId` in the where clause, two orgs that
   * both happen to use team key `BUG` could return each other's `BUG-1` —
   * not a data leak (resolvers re-check `organizationId`) but the caller's
   * own issue would be unreachable when another org claims the same key
   * first in the index.
   */
  async findByIdentifier(orgId: string, identifier: string): Promise<Issue | null> {
    return this.prisma.issue.findFirst({
      include: { labelAssignments: { include: { label: true } } },
      where: {
        OR: [{ identifier }, { previousIdentifiers: { has: identifier } }],
        organizationId: orgId,
      },
    });
  }

  async findMany(
    orgId: string,
    filter: IssueFilter,
    pagination: {
      first?: number;
      after?: string;
      last?: number;
      before?: string;
    },
    includeArchived = false,
  ): Promise<IssuePage> {
    const where = this.buildWhere(orgId, filter, includeArchived);
    const take = pagination.first ?? pagination.last ?? 50;
    const cursorId = pagination.after ?? pagination.before;
    // Forward pagination (first/after, or the no-args default) fetches one
    // extra row so hasNextPage reflects whether more rows actually exist
    // past this page — the old `issues.length === take` heuristic
    // over-reported hasNextPage whenever the remaining set happened to be
    // exactly `take` long (the common "last page" case). Backward
    // pagination (last/before) keeps the previous heuristic; Prisma's
    // negative-take + cursor semantics make an equivalent over-fetch
    // trickier to slice correctly, and `last`/`before` isn't exercised by
    // any current caller.
    const overFetchForward = !pagination.last;

    const [rawIssues, totalCount] = await Promise.all([
      this.prisma.issue.findMany({
        cursor: cursorId ? { id: cursorId } : undefined,
        include: { labelAssignments: { include: { label: true } } },
        // descriptionState is a YJS binary blob used only by the detail
        // panel's collaborative editor; it's not exposed in the GraphQL
        // Issue type. Loading it for every row on a list page is pure
        // over-fetch. findById keeps it.
        omit: { descriptionState: true },
        // sortOrder defaults to 0 for every issue, so ordering by it alone
        // is nondeterministic among ties — a cursor page could skip or
        // repeat rows across requests. `id` is a stable, unique tiebreak.
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: cursorId ? 1 : 0,
        take: pagination.last ? -take : overFetchForward ? take + 1 : take,
        where,
      }),
      this.prisma.issue.count({ where }),
    ]);

    const hasMore = overFetchForward && rawIssues.length > take;
    const issues = hasMore ? rawIssues.slice(0, take) : rawIssues;

    const startCursor = issues[0]?.id ?? null;
    const endCursor = issues[issues.length - 1]?.id ?? null;

    return {
      nodes: issues,
      pageInfo: {
        endCursor,
        hasNextPage: !!pagination.first && hasMore,
        hasPreviousPage: !!pagination.last && rawIssues.length === take,
        startCursor,
      },
      totalCount,
    };
  }

  async findByTeamId(
    teamId: string,
    includeArchived = false,
    guestUserId?: string,
  ): Promise<IssueListRow[]> {
    // Guest visibility + snooze-hide, mirroring Cycle.issues/Project.issues/
    // Issue.children — without this, Team.issues was a backdoor around the
    // top-level `issues` query's guest scoping and snooze filter.
    const ands: Array<Record<string, unknown>> = [IssueService.snoozeHideClause()];
    if (guestUserId) {
      ands.push({ OR: [{ creatorId: guestUserId }, { assigneeId: guestUserId }] });
    }
    return this.prisma.issue.findMany({
      include: { labelAssignments: { include: { label: true } } },
      // See findMany: descriptionState is never rendered in lists.
      omit: { descriptionState: true },
      orderBy: { sortOrder: 'asc' },
      where: {
        AND: ands,
        archivedAt: includeArchived ? undefined : null,
        teamId,
        trashed: false,
      },
    });
  }

  /**
   * Returns the updated issue plus any cascaded sibling/parent/child issues
   * the auto-close rules touched. Cascades run inside the same transaction
   * as the primary update so a crash mid-cascade cannot leave the tree in
   * an inconsistent state (and remote clients see all changes or none).
   * The caller is responsible for emitting one SyncAction per `cascaded`
   * entry so remote clients can reflect the cascade in real time.
   */
  async update(
    id: string,
    input: IssueUpdateInput,
    txHook?: IssueUpdateTxHook,
  ): Promise<{ issue: Issue; cascaded: Issue[] }> {
    assertValidTitle(input.title);
    assertValidDescription(input.description);
    assertValidPriority(input.priority);

    const data: Parameters<PrismaClient['issue']['update']>[0]['data'] = {};

    if (input.title !== undefined) {
      data.title = input.title;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.stateId !== undefined) {
      data.stateId = input.stateId;
    }
    if ('assigneeId' in input) {
      data.assigneeId = input.assigneeId;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
    }
    if ('estimate' in input) {
      data.estimate = input.estimate;
    }
    if ('dueDate' in input) {
      data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if ('startDate' in input) {
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if ('parentId' in input) {
      data.parentId = input.parentId;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }
    if (input.prioritySortOrder !== undefined) {
      data.prioritySortOrder = input.prioritySortOrder;
    }
    if (input.trashed !== undefined) {
      data.trashed = input.trashed;
    }
    if ('projectId' in input) {
      data.projectId = input.projectId;
      // Mirror the cycle branch: set the timestamp when joining a project,
      // clear it when leaving. Without the null branch the timestamp would
      // persist past project removal, polluting "added to project" filters.
      if (input.projectId) {
        data.addedToProjectAt = new Date();
      } else {
        data.addedToProjectAt = null;
      }
    }
    if ('projectMilestoneId' in input) {
      data.projectMilestoneId = input.projectMilestoneId;
    }
    if ('cycleId' in input) {
      data.cycleId = input.cycleId;
      if (input.cycleId) {
        data.addedToCycleAt = new Date();
      } else {
        data.addedToCycleAt = null;
      }
    }

    return this.prisma.$transaction(async tx => {
      // Fetch the current row once, up front — needed both for the stateId/
      // team check below AND to validate every other cross-entity reference
      // (parentId/projectId/cycleId/projectMilestoneId/assigneeId) against
      // THIS issue's org/team, not the caller-supplied `id` alone.
      const existing = await tx.issue.findUnique({
        select: {
          canceledAt: true,
          completedAt: true,
          organizationId: true,
          startedAt: true,
          stateId: true,
          teamId: true,
        },
        where: { id },
      });
      if (!existing) {
        throw new IssueNotFoundError();
      }

      // Validate stateId belongs to the same team as the issue. Create
      // already does this; the update path must too, or a member can move
      // their issue into another team's workflow state.
      // Also stamp lifecycle timestamps so analytics (lead/cycle time,
      // throughput) and the project progress rollup stay accurate
      // regardless of how the state transition is initiated (user,
      // automation, GitHub PR merge).
      if (input.stateId !== undefined) {
        const state = await tx.workflowState.findFirst({
          select: { teamId: true, type: true },
          where: { archivedAt: null, id: input.stateId },
        });
        if (!state || state.teamId !== existing.teamId) {
          throw new IssueInvalidStateError();
        }
        if (input.stateId !== existing.stateId) {
          const now = new Date();
          // First-set semantics for startedAt/completedAt/canceledAt:
          // stamp on transition into the matching category, clear when
          // moving back out of it. Mirrors the cascade path
          // (maybeCloseParentTx / maybeCloseChildrenTx) so user-initiated
          // and cascaded transitions converge on the same shape.
          data.startedAt =
            state.type === 'started' && !existing.startedAt ? now : existing.startedAt;
          data.completedAt = state.type === 'completed' ? now : null;
          data.canceledAt = state.type === 'canceled' ? now : null;
        }
      }

      // Cross-org / cross-team reference validation — see `create()` for
      // the full rationale. Falsy values (undefined = unchanged, null =
      // clearing the reference) are skipped by validateReferences itself.
      await this.validateReferences(tx, existing.organizationId, [existing.teamId], {
        assigneeId: input.assigneeId,
        cycleId: input.cycleId,
        parentId: input.parentId,
        projectId: input.projectId,
        projectMilestoneId: input.projectMilestoneId,
      });

      const issue = await tx.issue.update({ data, where: { id } });

      if (input.labelIds !== undefined) {
        await this.syncLabels(tx, id, existing.organizationId, input.labelIds);
      }

      const cascaded: Issue[] = [];
      if (input.stateId !== undefined) {
        const team = await tx.team.findUnique({
          select: {
            autoCloseChildIssues: true,
            autoCloseParentIssues: true,
          },
          where: { id: issue.teamId },
        });

        if (team?.autoCloseParentIssues && issue.parentId) {
          const closedParent = await this.maybeCloseParentTx(tx, issue.parentId, issue.teamId);
          if (closedParent) {
            cascaded.push(closedParent);
          }
        }

        if (team?.autoCloseChildIssues) {
          const closedChildren = await this.maybeCloseChildrenTx(
            tx,
            issue.id,
            issue.stateId,
            issue.teamId,
          );
          cascaded.push(...closedChildren);
        }
      }

      // Persist SyncAction(s) for the issue + any cascaded rows inside this
      // transaction so the markers can't survive a rollback of the writes.
      await txHook?.(tx, { cascaded, issue });

      return { cascaded, issue };
    });
  }

  async archive(id: string, txHook?: IssueRowTxHook): Promise<Issue> {
    return this.prisma.$transaction(async tx => {
      const issue = await tx.issue.update({
        data: { archivedAt: new Date() },
        where: { id },
      });
      await txHook?.(tx, issue);
      return issue;
    });
  }

  async unarchive(id: string, txHook?: IssueRowTxHook): Promise<Issue> {
    return this.prisma.$transaction(async tx => {
      const issue = await tx.issue.update({
        data: { archivedAt: null },
        where: { id },
      });
      await txHook?.(tx, issue);
      return issue;
    });
  }

  async delete(id: string, txHook?: IssueRowTxHook): Promise<Issue> {
    return this.prisma.$transaction(async tx => {
      const issue = await tx.issue.delete({ where: { id } });
      // Pass the just-deleted row so the resolver can record a 'D' SyncAction
      // (with null data) atomically with the delete.
      await txHook?.(tx, issue);
      return issue;
    });
  }

  /**
   * Snooze an issue until `until`. The `snoozed_until_at` / `snoozed_by_id`
   * columns already exist on the issue row — this method just sets them.
   * List/board queries hide snoozed issues that haven't woken up yet
   * (the SnoozedIssues view in IssueFilter); waking up is purely a
   * function of `now() >= snoozedUntilAt`, no background job needed.
   */
  async snooze(id: string, userId: string, until: Date, txHook?: IssueRowTxHook): Promise<Issue> {
    return this.prisma.$transaction(async tx => {
      const issue = await tx.issue.update({
        data: { snoozedById: userId, snoozedUntilAt: until },
        where: { id },
      });
      await txHook?.(tx, issue);
      return issue;
    });
  }

  async unsnooze(id: string, txHook?: IssueRowTxHook): Promise<Issue> {
    return this.prisma.$transaction(async tx => {
      const issue = await tx.issue.update({
        data: { snoozedById: null, snoozedUntilAt: null },
        where: { id },
      });
      await txHook?.(tx, issue);
      return issue;
    });
  }

  /**
   * Apply the same `IssueUpdateInput` to every id in `ids`, all inside a
   * single transaction so a partial failure rolls back. The auto-close
   * cascade is intentionally skipped here — bulk operations are typically
   * a manual reorganisation (move 50 issues into a project, change
   * priority on a backlog batch) and running cascades per row would
   * silently transition unrelated parents/children. Caller emits one
   * SyncAction per row from the returned array.
   *
   * Returns the updated rows in input order; throws if any id doesn't
   * belong to the issuer's team (caller pre-checks team membership).
   */
  async bulkUpdate(
    orgId: string,
    ids: string[],
    input: IssueUpdateInput,
    txHook?: IssuesBulkTxHook,
  ): Promise<Issue[]> {
    if (ids.length === 0) {
      return [];
    }
    // Hard cap on bulk size so a runaway client can't take a request slot
    // for minutes. 200 matches Linear's UI cap for the bulk toolbar.
    if (ids.length > 200) {
      throw new IssueBulkLimitExceededError();
    }
    assertValidTitle(input.title);
    assertValidDescription(input.description);
    assertValidPriority(input.priority);

    const data: Parameters<PrismaClient['issue']['update']>[0]['data'] = {};
    if (input.title !== undefined) {
      data.title = input.title;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.stateId !== undefined) {
      data.stateId = input.stateId;
    }
    if ('assigneeId' in input) {
      data.assigneeId = input.assigneeId;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
    }
    if ('estimate' in input) {
      data.estimate = input.estimate;
    }
    if ('dueDate' in input) {
      data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if ('startDate' in input) {
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if (input.trashed !== undefined) {
      data.trashed = input.trashed;
    }
    if ('projectId' in input) {
      data.projectId = input.projectId;
      data.addedToProjectAt = input.projectId ? new Date() : null;
    }
    if ('projectMilestoneId' in input) {
      data.projectMilestoneId = input.projectMilestoneId;
    }
    if ('cycleId' in input) {
      data.cycleId = input.cycleId;
      data.addedToCycleAt = input.cycleId ? new Date() : null;
    }
    if ('parentId' in input) {
      data.parentId = input.parentId;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }
    if (input.prioritySortOrder !== undefined) {
      data.prioritySortOrder = input.prioritySortOrder;
    }

    return this.prisma.$transaction(async tx => {
      // Verify every id belongs to the org before touching anything. A row
      // count mismatch means at least one id is cross-tenant or missing —
      // either way, abort the whole batch. Also pull stateId/startedAt so
      // the lifecycle-timestamp stamping below can tell which rows are
      // actually transitioning.
      const claim = await tx.issue.findMany({
        select: { id: true, startedAt: true, stateId: true, teamId: true },
        where: { id: { in: ids }, organizationId: orgId },
      });
      if (claim.length !== ids.length) {
        throw new IssueNotFoundError();
      }

      // stateId validation: if a target state was supplied, every issue
      // must belong to a team that owns that state. Mixing teams in a
      // single bulk state change is a no-op the caller must prevent.
      let targetState: { teamId: string; type: string } | null = null;
      if (input.stateId !== undefined) {
        const state = await tx.workflowState.findFirst({
          select: { teamId: true, type: true },
          where: { archivedAt: null, id: input.stateId },
        });
        if (!state) {
          throw new IssueInvalidStateError();
        }
        if (claim.some(c => c.teamId !== state.teamId)) {
          throw new IssueInvalidStateError();
        }
        targetState = state;
      }

      // Cross-org / cross-team reference validation — same rule as
      // create()/update(). cycleId is checked against every distinct team
      // represented in the batch (a single cycle can't span teams).
      const teamIds = Array.from(new Set(claim.map(c => c.teamId)));
      await this.validateReferences(tx, orgId, teamIds, {
        assigneeId: input.assigneeId,
        cycleId: input.cycleId,
        parentId: input.parentId,
        projectId: input.projectId,
        projectMilestoneId: input.projectMilestoneId,
      });

      if (input.labelIds !== undefined) {
        // Bulk label replacement: sequential per-row because Prisma's
        // interactive transaction client serialises commands over one
        // connection — Promise.all here can throw "Transaction already
        // closed" or apply writes out of order under load.
        for (const id of ids) {
          await this.syncLabels(tx as unknown as PrismaLike, id, orgId, input.labelIds ?? []);
        }
      }

      if (targetState) {
        // Replicate update()'s first-set / clear-on-leave lifecycle-
        // timestamp semantics for a bulk stateId change. Only rows actually
        // transitioning into the target state get startedAt/completedAt/
        // canceledAt touched — issues already sitting at that state must
        // not have their historical completedAt/canceledAt clobbered with
        // `now` just because they were swept up in the same batch.
        const now = new Date();
        const byId = new Map(claim.map(c => [c.id, c]));
        const transitioning = ids.filter(rowId => byId.get(rowId)?.stateId !== input.stateId);
        const nonTransitioning = ids.filter(rowId => !transitioning.includes(rowId));

        if (nonTransitioning.length > 0) {
          await tx.issue.updateMany({
            data,
            where: { id: { in: nonTransitioning }, organizationId: orgId },
          });
        }

        if (transitioning.length > 0) {
          const clearBase = {
            canceledAt: targetState.type === 'canceled' ? now : null,
            completedAt: targetState.type === 'completed' ? now : null,
          };
          const stampStarted = targetState.type === 'started';
          const needsStartedStamp = stampStarted
            ? transitioning.filter(rowId => !byId.get(rowId)?.startedAt)
            : [];
          const noStartedStamp = transitioning.filter(rowId => !needsStartedStamp.includes(rowId));

          if (noStartedStamp.length > 0) {
            await tx.issue.updateMany({
              data: { ...data, ...clearBase },
              where: { id: { in: noStartedStamp }, organizationId: orgId },
            });
          }
          if (needsStartedStamp.length > 0) {
            await tx.issue.updateMany({
              data: { ...data, ...clearBase, startedAt: now },
              where: { id: { in: needsStartedStamp }, organizationId: orgId },
            });
          }
        }
      } else {
        await tx.issue.updateMany({
          data,
          where: { id: { in: ids }, organizationId: orgId },
        });
      }

      // Re-read so the caller can emit one SyncAction per updated row.
      // Ordered by input position so the SyncAction sequence is deterministic.
      const updated = await tx.issue.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(updated.map(u => [u.id, u]));
      const ordered = ids.map(id => byId.get(id)).filter((u): u is Issue => u !== undefined);

      // Record one SyncAction per row inside this transaction so the markers
      // can't outlive a rollback of the batch. Publish happens after commit.
      await txHook?.(tx, ordered);

      return ordered;
    });
  }

  /** Active issues currently scoped to a cycle, ordered for list display. */
  async findActiveByCycleId(cycleId: string): Promise<IssueListRow[]> {
    return this.prisma.issue.findMany({
      omit: { descriptionState: true },
      orderBy: { sortOrder: 'asc' },
      // Hide snoozed-not-yet-woken issues here too, for consistency with
      // the top-level `issues` query. Relation resolvers (Cycle.issues,
      // Project.issues, etc.) read this method so the predicate has to
      // live at the service layer, not duplicated per resolver.
      where: {
        archivedAt: null,
        cycleId,
        trashed: false,
        ...IssueService.snoozeHideClause(),
      },
    });
  }

  /**
   * Where-fragment that hides snoozed-not-yet-woken issues. Returns
   * `{ OR: [...] }` so it composes via spread into any where object.
   * Centralised so relation resolvers (Project.issues, Cycle.issues,
   * Issue.children) and the main query stay in sync — there's exactly
   * one definition of "what counts as snoozed".
   */
  static snoozeHideClause(): { OR: Array<Record<string, unknown>> } {
    return {
      OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: new Date() } }],
    };
  }

  /** Fetch a set of issues by id, scoped to a single org. Used by the cycle
   *  rollover broadcast to ship one SyncAction per moved issue. */
  async findByIdsInOrg(ids: string[], orgId: string): Promise<Issue[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.issue.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
  }

  async getLabels(issueId: string): Promise<IssueLabel[]> {
    const assignments = await this.prisma.issueLabelAssignment.findMany({
      include: { label: true },
      where: { issueId },
    });
    return assignments.map(a => a.label);
  }

  private async maybeCloseParentTx(
    tx: Pick<PrismaClient, 'issue' | 'workflowState'>,
    parentId: string,
    teamId: string,
  ): Promise<Issue | null> {
    // Get all non-archived children of this parent
    const siblings = await tx.issue.findMany({
      include: { state: { select: { type: true } } },
      where: { archivedAt: null, parentId, trashed: false },
    });
    if (siblings.length === 0) {
      return null;
    }

    // Check if all are completed or cancelled
    const allDone = siblings.every(
      s => s.state.type === 'completed' || s.state.type === 'canceled',
    );
    if (!allDone) {
      return null;
    }

    // Get parent, check it's not already done
    const parent = await tx.issue.findUnique({
      include: { state: { select: { type: true } } },
      where: { id: parentId },
    });
    if (!parent || parent.state.type === 'completed' || parent.state.type === 'canceled') {
      return null;
    }

    // Find first completed state for the team
    const completedState = await tx.workflowState.findFirst({
      orderBy: { position: 'asc' },
      where: { archivedAt: null, teamId, type: 'completed' },
    });
    if (!completedState) {
      return null;
    }

    return tx.issue.update({
      data: { completedAt: new Date(), stateId: completedState.id },
      where: { id: parentId },
    });
  }

  /**
   * Cascade the parent's newly-completed / -canceled state down to any open
   * children. Fires only when `team.autoCloseChildIssues` is enabled.
   * Returns the post-update rows so the caller can emit per-row SyncActions.
   */
  private async maybeCloseChildrenTx(
    tx: Pick<PrismaClient, 'issue' | 'workflowState'>,
    parentId: string,
    parentStateId: string,
    teamId: string,
  ): Promise<Issue[]> {
    const parentState = await tx.workflowState.findUnique({
      select: { type: true },
      where: { id: parentStateId },
    });
    if (!parentState || (parentState.type !== 'completed' && parentState.type !== 'canceled')) {
      return [];
    }

    const children = await tx.issue.findMany({
      include: { state: { select: { type: true } } },
      where: { archivedAt: null, parentId, trashed: false },
    });
    const openChildren = children.filter(
      c => c.state.type !== 'completed' && c.state.type !== 'canceled',
    );
    if (openChildren.length === 0) {
      return [];
    }

    // Match the parent's final state by type (completed → completed,
    // canceled → canceled); fall back to team's first state of that type.
    const targetState = await tx.workflowState.findFirst({
      orderBy: { position: 'asc' },
      where: {
        archivedAt: null,
        teamId,
        type: parentState.type,
      },
    });
    if (!targetState) {
      return [];
    }

    const now = new Date();
    const ids = openChildren.map(c => c.id);
    await tx.issue.updateMany({
      data: {
        stateId: targetState.id,
        ...(parentState.type === 'completed' ? { completedAt: now } : {}),
        ...(parentState.type === 'canceled' ? { canceledAt: now } : {}),
      },
      where: { id: { in: ids } },
    });
    // Synthesize post-update rows from the pre-update children + the
    // fields we just wrote, instead of re-reading. updateMany doesn't
    // return rows in Prisma/Postgres, and an extra findMany doubles the
    // round-trips on every cascade. `state` is dropped (it was the
    // pre-update include for type filtering, not a column).
    //
    // `updatedAt` is auto-managed by Prisma via `@updatedAt` and we just
    // wrote each row, so we set it to `now` here too — without that, the
    // SyncAction + webhook payloads for the cascaded rows would carry
    // the pre-update timestamp and remote clients would see a stale
    // "Updated 2 days ago" until the next bootstrap.
    return openChildren.map(({ state: _state, ...child }) => ({
      ...child,
      canceledAt: parentState.type === 'canceled' ? now : child.canceledAt,
      completedAt: parentState.type === 'completed' ? now : child.completedAt,
      stateId: targetState.id,
      updatedAt: now,
    })) as Issue[];
  }

  private async syncLabels(
    tx: PrismaLike,
    issueId: string,
    orgId: string,
    labelIds: string[],
  ): Promise<void> {
    // Enforce single-select-per-group: if two labels share the same group
    // parent, keep only the last one in input order so group labels behave
    // as radio buttons, not checkboxes. Also drops any labelId that doesn't
    // belong to this org (see enforceSingleSelectPerGroup) — a foreign or
    // garbage label id must never become attachable to this issue.
    const effectiveIds = await this.enforceSingleSelectPerGroup(tx, orgId, labelIds);

    await tx.issueLabelAssignment.deleteMany({ where: { issueId } });

    if (effectiveIds.length > 0) {
      await tx.issueLabelAssignment.createMany({
        data: effectiveIds.map(labelId => ({ issueId, labelId })),
        skipDuplicates: true,
      });
    }
  }

  private async enforceSingleSelectPerGroup(
    tx: PrismaLike,
    orgId: string,
    labelIds: string[],
  ): Promise<string[]> {
    if (labelIds.length === 0) {
      return [];
    }
    const labels = await tx.issueLabel.findMany({
      select: { id: true, organizationId: true, parentId: true },
      where: { id: { in: labelIds } },
    });
    // Labels that don't exist, or that belong to a different org, are
    // dropped silently (not surfaced as an error — a stale/garbage id in
    // the list shouldn't fail the whole write, same as the prior
    // not-found handling, but a CROSS-ORG label must never be attachable).
    const byId = new Map(labels.filter(l => l.organizationId === orgId).map(l => [l.id, l]));
    // Walk input order; last writer per group parent wins.
    const seenGroup = new Map<string, string>();
    for (const id of labelIds) {
      const label = byId.get(id);
      if (label?.parentId) {
        seenGroup.set(label.parentId, id);
      }
    }
    const survivorSet = new Set(seenGroup.values());
    return labelIds.filter(id => {
      const label = byId.get(id);
      if (!label) {
        return false;
      }
      return !label.parentId || survivorSet.has(id);
    });
  }

  /**
   * Validates that every provided cross-entity reference belongs to `orgId`
   * (and, for cycleId, to every team in `teamIds`). Falsy values (undefined
   * = "no change"/"not provided", null = "clear the reference") are
   * skipped — there's nothing to look up. Throws IssueInvalidReferenceError
   * on any mismatch. Shared by create()/update()/bulkUpdate() so the three
   * write paths can't drift out of sync on which references get checked.
   */
  private async validateReferences(
    tx: Pick<
      PrismaClient,
      'cycle' | 'issue' | 'organizationMember' | 'project' | 'projectMilestone'
    >,
    orgId: string,
    teamIds: string[],
    refs: IssueReferenceInput,
  ): Promise<void> {
    if (refs.parentId) {
      const parent = await tx.issue.findUnique({
        select: { organizationId: true },
        where: { id: refs.parentId },
      });
      if (!parent || parent.organizationId !== orgId) {
        throw new IssueInvalidReferenceError('parentId');
      }
    }

    if (refs.projectId) {
      const project = await tx.project.findUnique({
        select: { organizationId: true },
        where: { id: refs.projectId },
      });
      if (!project || project.organizationId !== orgId) {
        throw new IssueInvalidReferenceError('projectId');
      }
    }

    if (refs.cycleId) {
      const cycle = await tx.cycle.findUnique({
        select: { organizationId: true, teamId: true },
        where: { id: refs.cycleId },
      });
      if (
        !cycle ||
        cycle.organizationId !== orgId ||
        teamIds.some(teamId => teamId !== cycle.teamId)
      ) {
        throw new IssueInvalidReferenceError('cycleId');
      }
    }

    if (refs.projectMilestoneId) {
      const milestone = await tx.projectMilestone.findUnique({
        select: { project: { select: { organizationId: true } }, projectId: true },
        where: { id: refs.projectMilestoneId },
      });
      if (!milestone || milestone.project.organizationId !== orgId) {
        throw new IssueInvalidReferenceError('projectMilestoneId');
      }
      if (refs.projectId && milestone.projectId !== refs.projectId) {
        throw new IssueInvalidReferenceError('projectMilestoneId');
      }
    }

    if (refs.assigneeId) {
      const member = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: refs.assigneeId } },
      });
      if (!member) {
        throw new IssueInvalidReferenceError('assigneeId');
      }
    }
  }

  private buildWhere(orgId: string, filter: IssueFilter, includeArchived: boolean) {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      trashed: filter.trashed ?? false,
    };

    if (!includeArchived) {
      where.archivedAt = null;
    }

    if (filter.teamId) {
      where.teamId = filter.teamId;
    }
    if (filter.stateId) {
      where.stateId = filter.stateId;
    }
    if (filter.priority !== undefined) {
      where.priority = filter.priority;
    }

    if ('assigneeId' in filter) {
      where.assigneeId = filter.assigneeId;
    }

    // Multi-predicate filters collide on a single `where.OR` slot, so we
    // combine them under AND. Today this matters for two filters:
    //   * guest visibility (creator-or-assignee)
    //   * snooze hiding (snoozedUntilAt IS NULL OR <= now)
    // Each is added as its own AND clause with an internal OR.
    const ands: Array<Record<string, unknown>> = [];

    if (filter.guestUserId) {
      ands.push({
        OR: [{ creatorId: filter.guestUserId }, { assigneeId: filter.guestUserId }],
      });
    }

    if (!filter.includeSnoozed) {
      ands.push({
        OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: new Date() } }],
      });
    }

    if (ands.length > 0) {
      where.AND = ands;
    }

    return where;
  }

  async addReaction(
    issueId: string,
    userId: string,
    emoji: string,
    txHook?: IssueReactionTxHook,
  ): Promise<IssueReaction & { user: unknown }> {
    const existing = await this.prisma.issue.findUnique({
      where: { id: issueId },
    });
    if (!existing) {
      throw new IssueNotFoundError();
    }

    return this.prisma.$transaction(async tx => {
      const reaction = await tx.issueReaction.upsert({
        create: { emoji, issueId, userId },
        include: { user: true },
        update: {},
        where: { issueId_userId_emoji: { emoji, issueId, userId } },
      });
      await txHook?.(tx, reaction as unknown as { id: string } & Record<string, unknown>);
      return reaction as unknown as IssueReaction & { user: unknown };
    });
  }

  async removeReaction(
    issueId: string,
    userId: string,
    emoji: string,
    txHook?: IssueReactionTxHook,
  ): Promise<{ id: string }> {
    const reaction = await this.prisma.issueReaction.findUnique({
      where: { issueId_userId_emoji: { emoji, issueId, userId } },
    });
    if (!reaction) {
      throw new IssueReactionNotFoundError();
    }

    return this.prisma.$transaction(async tx => {
      await tx.issueReaction.delete({
        where: { id: reaction.id },
      });
      await txHook?.(tx, reaction as unknown as { id: string } & Record<string, unknown>);
      return { id: reaction.id };
    });
  }

  async listReactions(issueId: string): Promise<Array<IssueReaction & { user: unknown }>> {
    return this.prisma.issueReaction.findMany({
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      where: { issueId },
    }) as unknown as Array<IssueReaction & { user: unknown }>;
  }
}

export class IssueNotFoundError extends Error {
  constructor() {
    super('Issue not found');
    this.name = 'IssueNotFoundError';
  }
}

export class IssueReactionNotFoundError extends Error {
  constructor() {
    super('Reaction not found');
    this.name = 'IssueReactionNotFoundError';
  }
}

export class IssueStateRequiredError extends Error {
  constructor() {
    super('No workflow state found for the team. Please set a default state.');
    this.name = 'IssueStateRequiredError';
  }
}

export class IssueInvalidStateError extends Error {
  constructor() {
    super('Workflow state must belong to the same team as the issue');
    this.name = 'IssueInvalidStateError';
  }
}

export class IssueBulkLimitExceededError extends Error {
  constructor() {
    super('Bulk update is capped at 200 issues per request');
    this.name = 'IssueBulkLimitExceededError';
  }
}

/** A caller-supplied parentId/projectId/cycleId/projectMilestoneId/assigneeId
 *  does not resolve inside the issue's own organization (or, for cycleId,
 *  team) — cross-tenant / cross-team reference injection. */
export class IssueInvalidReferenceError extends Error {
  constructor(field: string) {
    super(`${field} does not resolve to a valid reference in this organization`);
    this.name = 'IssueInvalidReferenceError';
  }
}

/** A title/description/priority value violates the server-side input caps. */
export class IssueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueValidationError';
  }
}
