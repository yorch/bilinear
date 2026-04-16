import type { Issue, IssueLabel, PrismaClient } from '../../generated/prisma';

type PrismaLike = Pick<PrismaClient, 'issue' | 'issueLabelAssignment' | 'team'>;

export interface IssueCreateInput {
  id?: string;
  title: string;
  description?: string;
  teamId: string;
  stateId?: string;
  assigneeId?: string;
  priority?: number;
  estimate?: number;
  dueDate?: string; // ISO date string YYYY-MM-DD
  labelIds?: string[];
  parentId?: string;
  sortOrder?: number;
  projectId?: string;
  projectMilestoneId?: string;
  cycleId?: string;
}

export interface IssueUpdateInput {
  title?: string;
  description?: string;
  stateId?: string;
  assigneeId?: string | null;
  priority?: number;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: string[];
  parentId?: string | null;
  sortOrder?: number;
  prioritySortOrder?: number;
  trashed?: boolean;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  cycleId?: string | null;
}

export interface IssueFilter {
  teamId?: string;
  stateId?: string;
  assigneeId?: string | null;
  priority?: number;
  trashed?: boolean;
  includeArchived?: boolean;
}

export interface IssuePage {
  nodes: Issue[];
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
  ): Promise<Issue> {
    return this.prisma.$transaction(async tx => {
      // Atomically increment issueCount and use it as the issue number
      const team = await tx.team.update({
        data: { issueCount: { increment: 1 } },
        where: { id: input.teamId },
      });
      const number = team.issueCount;
      const identifier = `${team.key}-${number}`;

      // If no stateId supplied, fall back to team's defaultIssueStateId
      const stateId = input.stateId ?? team.defaultIssueStateId;
      if (!stateId) {
        throw new IssueStateRequiredError();
      }

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
            inheritedProjectMilestoneId =
              parent.projectMilestoneId ?? undefined;
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

  async findByIdentifier(identifier: string): Promise<Issue | null> {
    return this.prisma.issue.findFirst({
      include: { labelAssignments: { include: { label: true } } },
      where: { identifier },
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

  async findByTeamId(
    teamId: string,
    includeArchived = false,
  ): Promise<Issue[]> {
    return this.prisma.issue.findMany({
      include: { labelAssignments: { include: { label: true } } },
      orderBy: { sortOrder: 'asc' },
      where: {
        archivedAt: includeArchived ? undefined : null,
        teamId,
        trashed: false,
      },
    });
  }

  async update(id: string, input: IssueUpdateInput): Promise<Issue> {
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
      if (input.projectId) {
        data.addedToProjectAt = new Date();
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

    const issue = await this.prisma.$transaction(async tx => {
      const updated = await tx.issue.update({ data, where: { id } });

      if (input.labelIds !== undefined) {
        await this.syncLabels(tx, id, input.labelIds);
      }

      return updated;
    });

    if (input.stateId !== undefined) {
      // Read the team's cascade flags once so the two cascade checks share the
      // same lookup and stay consistent.
      const team = await this.prisma.team.findUnique({
        select: {
          autoCloseChildIssues: true,
          autoCloseParentIssues: true,
        },
        where: { id: issue.teamId },
      });

      if (team?.autoCloseParentIssues && issue.parentId) {
        await this.maybeCloseParent(issue.parentId, issue.teamId);
      }

      if (team?.autoCloseChildIssues) {
        await this.maybeCloseChildren(issue.id, issue.stateId, issue.teamId);
      }
    }

    return issue;
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

  async getLabels(issueId: string): Promise<IssueLabel[]> {
    const assignments = await this.prisma.issueLabelAssignment.findMany({
      include: { label: true },
      where: { issueId },
    });
    return assignments.map(a => a.label);
  }

  private async maybeCloseParent(
    parentId: string,
    teamId: string,
  ): Promise<void> {
    // Get all non-archived children of this parent
    const siblings = await this.prisma.issue.findMany({
      include: { state: { select: { type: true } } },
      where: { archivedAt: null, parentId, trashed: false },
    });
    if (siblings.length === 0) {
      return;
    }

    // Check if all are completed or cancelled
    const allDone = siblings.every(
      s => s.state.type === 'completed' || s.state.type === 'canceled',
    );
    if (!allDone) {
      return;
    }

    // Get parent, check it's not already done
    const parent = await this.prisma.issue.findUnique({
      include: { state: { select: { type: true } } },
      where: { id: parentId },
    });
    if (
      !parent ||
      parent.state.type === 'completed' ||
      parent.state.type === 'canceled'
    ) {
      return;
    }

    // Find first completed state for the team
    const completedState = await this.prisma.workflowState.findFirst({
      orderBy: { position: 'asc' },
      where: { archivedAt: null, teamId, type: 'completed' },
    });
    if (!completedState) {
      return;
    }

    await this.prisma.issue.update({
      data: { completedAt: new Date(), stateId: completedState.id },
      where: { id: parentId },
    });
  }

  /**
   * Cascade the parent's newly-completed / -canceled state down to any open
   * children. Fires only when `team.autoCloseChildIssues` is enabled.
   * No-op if the parent did not move into a terminal state.
   */
  private async maybeCloseChildren(
    parentId: string,
    parentStateId: string,
    teamId: string,
  ): Promise<void> {
    const parentState = await this.prisma.workflowState.findUnique({
      select: { type: true },
      where: { id: parentStateId },
    });
    if (
      !parentState ||
      (parentState.type !== 'completed' && parentState.type !== 'canceled')
    ) {
      return;
    }

    const children = await this.prisma.issue.findMany({
      include: { state: { select: { type: true } } },
      where: { archivedAt: null, parentId, trashed: false },
    });
    const openChildren = children.filter(
      c => c.state.type !== 'completed' && c.state.type !== 'canceled',
    );
    if (openChildren.length === 0) {
      return;
    }

    // Match the parent's final state by type (completed → completed,
    // canceled → canceled); fall back to team's first state of that type.
    const targetState = await this.prisma.workflowState.findFirst({
      orderBy: { position: 'asc' },
      where: {
        archivedAt: null,
        teamId,
        type: parentState.type,
      },
    });
    if (!targetState) {
      return;
    }

    const now = new Date();
    await this.prisma.issue.updateMany({
      data: {
        stateId: targetState.id,
        ...(parentState.type === 'completed' ? { completedAt: now } : {}),
        ...(parentState.type === 'canceled' ? { canceledAt: now } : {}),
      },
      where: { id: { in: openChildren.map(c => c.id) } },
    });
  }

  private async syncLabels(
    tx: PrismaLike,
    issueId: string,
    labelIds: string[],
  ): Promise<void> {
    // Remove all existing label assignments
    await tx.issueLabelAssignment.deleteMany({ where: { issueId } });

    if (labelIds.length > 0) {
      await tx.issueLabelAssignment.createMany({
        data: labelIds.map(labelId => ({ issueId, labelId })),
        skipDuplicates: true,
      });
    }
  }

  private buildWhere(
    orgId: string,
    filter: IssueFilter,
    includeArchived: boolean,
  ) {
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
