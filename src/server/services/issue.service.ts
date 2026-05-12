import type { Issue, IssueLabel, PrismaClient } from '../../generated/prisma';

type PrismaLike = Pick<PrismaClient, 'issue' | 'issueLabelAssignment' | 'team'>;

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
  stateId?: string;
  title?: string;
  trashed?: boolean;
}

export interface IssueFilter {
  assigneeId?: string | null;
  includeArchived?: boolean;
  priority?: number;
  stateId?: string;
  teamId?: string;
  trashed?: boolean;
}

// List-view queries omit the descriptionState YJS blob (see findMany/
// findByTeamId). Callers that need to render/edit the rich description
// re-fetch via findById / findByIdentifier.
export type IssueListRow = Omit<Issue, 'descriptionState'>;

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

  async create(orgId: string, creatorId: string, input: IssueCreateInput): Promise<Issue> {
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
            projectId: true,
            projectMilestoneId: true,
          },
          where: { id: input.parentId },
        });
        if (parent) {
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
      }

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
          startedTriageAt: enteringTriage ? new Date() : undefined,
          stateId,
          teamId: input.teamId,
          title: input.title,
        },
      });

      if (input.labelIds?.length) {
        await this.syncLabels(tx, issue.id, input.labelIds);
      }

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
      where: { identifier, organizationId: orgId },
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

    const [issues, totalCount] = await Promise.all([
      this.prisma.issue.findMany({
        cursor: cursorId ? { id: cursorId } : undefined,
        include: { labelAssignments: { include: { label: true } } },
        // descriptionState is a YJS binary blob used only by the detail
        // panel's collaborative editor; it's not exposed in the GraphQL
        // Issue type. Loading it for every row on a list page is pure
        // over-fetch. findById keeps it.
        omit: { descriptionState: true },
        orderBy: { sortOrder: 'asc' },
        skip: cursorId ? 1 : 0,
        take: pagination.last ? -take : take,
        where,
      }),
      this.prisma.issue.count({ where }),
    ]);

    const startCursor = issues[0]?.id ?? null;
    const endCursor = issues[issues.length - 1]?.id ?? null;

    return {
      nodes: issues,
      pageInfo: {
        endCursor,
        hasNextPage: !!pagination.first && issues.length === take,
        hasPreviousPage: !!pagination.last && issues.length === take,
        startCursor,
      },
      totalCount,
    };
  }

  async findByTeamId(teamId: string, includeArchived = false): Promise<IssueListRow[]> {
    return this.prisma.issue.findMany({
      include: { labelAssignments: { include: { label: true } } },
      // See findMany: descriptionState is never rendered in lists.
      omit: { descriptionState: true },
      orderBy: { sortOrder: 'asc' },
      where: {
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
  async update(id: string, input: IssueUpdateInput): Promise<{ issue: Issue; cascaded: Issue[] }> {
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
      // Validate stateId belongs to the same team as the issue. Create
      // already does this; the update path must too, or a member can move
      // their issue into another team's workflow state.
      if (input.stateId !== undefined) {
        const existing = await tx.issue.findUnique({
          select: { teamId: true },
          where: { id },
        });
        if (!existing) {
          throw new IssueInvalidStateError();
        }
        const state = await tx.workflowState.findFirst({
          select: { teamId: true },
          where: { archivedAt: null, id: input.stateId },
        });
        if (!state || state.teamId !== existing.teamId) {
          throw new IssueInvalidStateError();
        }
      }

      const issue = await tx.issue.update({ data, where: { id } });

      if (input.labelIds !== undefined) {
        await this.syncLabels(tx, id, input.labelIds);
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

      return { cascaded, issue };
    });
  }

  async archive(id: string): Promise<Issue> {
    return this.prisma.issue.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async unarchive(id: string): Promise<Issue> {
    return this.prisma.issue.update({
      data: { archivedAt: null },
      where: { id },
    });
  }

  async delete(id: string): Promise<Issue> {
    return this.prisma.issue.delete({ where: { id } });
  }

  /** Active issues currently scoped to a cycle, ordered for list display. */
  async findActiveByCycleId(cycleId: string): Promise<IssueListRow[]> {
    return this.prisma.issue.findMany({
      omit: { descriptionState: true },
      orderBy: { sortOrder: 'asc' },
      where: { archivedAt: null, cycleId, trashed: false },
    });
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

  private async syncLabels(tx: PrismaLike, issueId: string, labelIds: string[]): Promise<void> {
    // Remove all existing label assignments
    await tx.issueLabelAssignment.deleteMany({ where: { issueId } });

    if (labelIds.length > 0) {
      await tx.issueLabelAssignment.createMany({
        data: labelIds.map(labelId => ({ issueId, labelId })),
        skipDuplicates: true,
      });
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

    return where;
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
