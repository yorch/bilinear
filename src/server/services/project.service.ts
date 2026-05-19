import type {
  Prisma,
  PrismaClient,
  Project,
  ProjectMilestone,
  ProjectUpdate,
} from '../../generated/prisma';

export interface ProgressHistoryEntry {
  /** UTC date in YYYY-MM-DD form */
  t: string;
  v: number;
}

function parseHistory(value: unknown): ProgressHistoryEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter(
    (e): e is ProgressHistoryEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as { t?: unknown }).t === 'string' &&
      typeof (e as { v?: unknown }).v === 'number',
  );
}

function appendOrReplaceToday(
  history: ProgressHistoryEntry[],
  today: string,
  value: number,
): ProgressHistoryEntry[] {
  const last = history[history.length - 1];
  if (last?.t === today) {
    return [...history.slice(0, -1), { t: today, v: value }];
  }
  return [...history, { t: today, v: value }];
}

export interface ProjectCreateInput {
  color?: string;
  description?: string;
  icon?: string;
  id?: string;
  leadId?: string;
  memberIds?: string[];
  name: string;
  startDate?: string;
  startDateResolution?: string;
  statusType?: string;
  targetDate?: string;
  targetDateResolution?: string;
  teamIds: string[];
}

export interface ProjectUpdateInput {
  color?: string;
  content?: string | null;
  description?: string;
  health?: string | null;
  icon?: string | null;
  leadId?: string | null;
  name?: string;
  priority?: number;
  startDate?: string | null;
  startDateResolution?: string | null;
  statusType?: string;
  targetDate?: string | null;
  targetDateResolution?: string | null;
}

export interface ProjectMilestoneCreateInput {
  description?: string;
  id?: string;
  name: string;
  projectId: string;
  sortOrder?: number;
  targetDate?: string;
}

export interface ProjectMilestoneUpdateInput {
  description?: string;
  name?: string;
  sortOrder?: number;
  targetDate?: string | null;
}

export interface ProjectUpdateCreateInput {
  body: string;
  bodyData: object;
  health: string;
  id?: string;
  projectId: string;
  userId: string;
}

export interface ProjectUpdateUpdateInput {
  body?: string;
  bodyData?: object;
  health?: string;
}

export class ProjectService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, creatorId: string, input: ProjectCreateInput): Promise<Project> {
    return this.prisma.$transaction(async tx => {
      const slugId = await this.generateUniqueSlugId(
        tx as unknown as PrismaClient,
        input.name,
        orgId,
      );

      const project = await tx.project.create({
        data: {
          color: input.color ?? '#6366f1',
          creatorId,
          description: input.description ?? '',
          icon: input.icon,
          id: input.id ?? undefined,
          leadId: input.leadId,
          name: input.name,
          organizationId: orgId,
          slugId,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          startDateResolution: input.startDateResolution,
          statusType: input.statusType ?? 'planned',
          targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
          targetDateResolution: input.targetDateResolution,
        },
      });

      if (input.teamIds.length > 0) {
        await tx.projectTeam.createMany({
          data: input.teamIds.map(teamId => ({
            projectId: project.id,
            teamId,
          })),
          skipDuplicates: true,
        });
      }

      if (input.memberIds && input.memberIds.length > 0) {
        await tx.projectMember.createMany({
          data: input.memberIds.map(userId => ({
            projectId: project.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      return project;
    });
  }

  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async findByOrgId(
    orgId: string,
    includeArchived = false,
    filter?: { statusType?: string; health?: string; leadId?: string },
  ): Promise<Project[]> {
    return this.prisma.project.findMany({
      orderBy: [{ prioritySortOrder: 'desc' }, { createdAt: 'desc' }],
      where: {
        organizationId: orgId,
        trashed: false,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(filter?.statusType ? { statusType: filter.statusType } : {}),
        ...(filter?.health ? { health: filter.health } : {}),
        ...(filter?.leadId ? { leadId: filter.leadId } : {}),
      },
    });
  }

  async update(id: string, input: ProjectUpdateInput): Promise<Project> {
    const data: Record<string, unknown> = {};

    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.content !== undefined) {
      data.content = input.content;
    }
    if (input.icon !== undefined) {
      data.icon = input.icon;
    }
    if (input.color !== undefined) {
      data.color = input.color;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
    }
    if (input.startDateResolution !== undefined) {
      data.startDateResolution = input.startDateResolution;
    }
    if (input.targetDateResolution !== undefined) {
      data.targetDateResolution = input.targetDateResolution;
    }

    if (input.statusType !== undefined) {
      data.statusType = input.statusType;
      if (input.statusType === 'inProgress') {
        data.startedAt = new Date();
      } else if (input.statusType === 'completed') {
        data.completedAt = new Date();
      } else if (input.statusType === 'canceled') {
        data.canceledAt = new Date();
      }
    }

    if (input.health !== undefined) {
      data.health = input.health;
      data.healthUpdatedAt = new Date();
    }

    if ('leadId' in input) {
      data.leadId = input.leadId;
    }
    if ('startDate' in input) {
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if ('targetDate' in input) {
      data.targetDate = input.targetDate ? new Date(input.targetDate) : null;
    }

    return this.prisma.project.update({
      data,
      where: { id },
    });
  }

  /** Toggle whether a project appears on the org's public roadmap. */
  async setRoadmapVisible(id: string, visible: boolean): Promise<Project> {
    return this.prisma.project.update({
      data: { roadmapVisible: visible },
      where: { id },
    });
  }

  async archive(id: string): Promise<Project> {
    return this.prisma.project.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async delete(id: string): Promise<Project> {
    return this.prisma.project.update({
      data: { archivedAt: new Date(), trashed: true },
      where: { id },
    });
  }

  async addTeam(projectId: string, teamId: string) {
    await this.prisma.projectTeam.createMany({
      data: [{ projectId, teamId }],
      skipDuplicates: true,
    });
  }

  async removeTeam(projectId: string, teamId: string) {
    return this.prisma.projectTeam.deleteMany({
      where: { projectId, teamId },
    });
  }

  async addMember(projectId: string, userId: string) {
    await this.prisma.projectMember.createMany({
      data: [{ projectId, userId }],
      skipDuplicates: true,
    });
  }

  async removeMember(projectId: string, userId: string) {
    return this.prisma.projectMember.deleteMany({
      where: { projectId, userId },
    });
  }

  async getTeams(projectId: string) {
    const relations = await this.prisma.projectTeam.findMany({
      include: { team: true },
      where: { projectId },
    });
    return relations.map(r => r.team);
  }

  async getMembers(projectId: string) {
    const relations = await this.prisma.projectMember.findMany({
      include: { user: true },
      where: { projectId },
    });
    return relations.map(r => r.user);
  }

  async getProgress(projectId: string): Promise<{ progress: number; scope: number }> {
    const [total, completed] = await Promise.all([
      this.prisma.issue.count({
        where: { archivedAt: null, projectId, trashed: false },
      }),
      this.prisma.issue.count({
        where: {
          archivedAt: null,
          completedAt: { not: null },
          projectId,
          trashed: false,
        },
      }),
    ]);
    return { progress: total > 0 ? completed / total : 0, scope: total };
  }

  /**
   * Append today's progress snapshot to the project's history JSONB columns
   * if the most recent entry isn't already from today. Cheap to call on every
   * progress read — a same-day call short-circuits without a write.
   *
   * Each history array stores entries of the shape `{ t: 'YYYY-MM-DD', v: number }`,
   * one per UTC day: the FIRST progress read of each UTC day stamps that day's
   * value and subsequent reads return the cached numbers unchanged. Intra-day
   * deltas are not captured by design — the sparkline shows day-resolution
   * trend. Returns the (possibly freshly-stamped) arrays.
   */
  async recordProgressSnapshotIfStale(projectId: string): Promise<{
    completedIssueCountHistory: ProgressHistoryEntry[];
    issueCountHistory: ProgressHistoryEntry[];
    completedScopeHistory: ProgressHistoryEntry[];
    scopeHistory: ProgressHistoryEntry[];
  }> {
    const project = await this.prisma.project.findUnique({
      select: {
        completedIssueCountHistory: true,
        completedScopeHistory: true,
        issueCountHistory: true,
        scopeHistory: true,
      },
      where: { id: projectId },
    });
    const empty: ProgressHistoryEntry[] = [];
    const completedIssueCountHistory = parseHistory(project?.completedIssueCountHistory) ?? empty;
    const issueCountHistory = parseHistory(project?.issueCountHistory) ?? empty;
    const completedScopeHistory = parseHistory(project?.completedScopeHistory) ?? empty;
    const scopeHistory = parseHistory(project?.scopeHistory) ?? empty;

    const today = new Date().toISOString().slice(0, 10);
    const lastIssueCount = issueCountHistory[issueCountHistory.length - 1];
    if (lastIssueCount?.t === today) {
      // We already wrote today's snapshot; skip the recompute + write entirely.
      return {
        completedIssueCountHistory,
        completedScopeHistory,
        issueCountHistory,
        scopeHistory,
      };
    }

    // Aggregate scope (sum of estimate, treating null as 0) and completed scope
    // in two single round trips rather than per-issue.
    const [issueCount, completedIssueCount, scopeAgg, completedScopeAgg] = await Promise.all([
      this.prisma.issue.count({
        where: { archivedAt: null, projectId, trashed: false },
      }),
      this.prisma.issue.count({
        where: {
          archivedAt: null,
          completedAt: { not: null },
          projectId,
          trashed: false,
        },
      }),
      this.prisma.issue.aggregate({
        _sum: { estimate: true },
        where: { archivedAt: null, projectId, trashed: false },
      }),
      this.prisma.issue.aggregate({
        _sum: { estimate: true },
        where: {
          archivedAt: null,
          completedAt: { not: null },
          projectId,
          trashed: false,
        },
      }),
    ]);

    const next = {
      completedIssueCountHistory: appendOrReplaceToday(
        completedIssueCountHistory,
        today,
        completedIssueCount,
      ),
      completedScopeHistory: appendOrReplaceToday(
        completedScopeHistory,
        today,
        completedScopeAgg._sum.estimate ?? 0,
      ),
      issueCountHistory: appendOrReplaceToday(issueCountHistory, today, issueCount),
      scopeHistory: appendOrReplaceToday(scopeHistory, today, scopeAgg._sum.estimate ?? 0),
    };

    await this.prisma.project.update({
      data: next as unknown as Prisma.ProjectUpdateInput,
      where: { id: projectId },
    });
    return next;
  }

  // ─── Milestones ──────────────────────────────────────────────────────────────

  async createMilestone(input: ProjectMilestoneCreateInput): Promise<ProjectMilestone> {
    return this.prisma.projectMilestone.create({
      data: {
        description: input.description,
        id: input.id ?? undefined,
        name: input.name,
        projectId: input.projectId,
        sortOrder: input.sortOrder ?? 0,
        targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
      },
    });
  }

  async findMilestoneById(id: string): Promise<ProjectMilestone | null> {
    return this.prisma.projectMilestone.findUnique({ where: { id } });
  }

  async getMilestones(projectId: string): Promise<ProjectMilestone[]> {
    return this.prisma.projectMilestone.findMany({
      orderBy: { sortOrder: 'asc' },
      where: { archivedAt: null, projectId },
    });
  }

  async updateMilestone(id: string, input: ProjectMilestoneUpdateInput): Promise<ProjectMilestone> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if ('targetDate' in input) {
      data.targetDate = input.targetDate ? new Date(input.targetDate) : null;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }

    return this.prisma.projectMilestone.update({ data, where: { id } });
  }

  async deleteMilestone(id: string): Promise<ProjectMilestone> {
    return this.prisma.projectMilestone.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  // ─── Project Updates ─────────────────────────────────────────────────────────

  async createProjectUpdate(input: ProjectUpdateCreateInput): Promise<ProjectUpdate> {
    const update = await this.prisma.projectUpdate.create({
      data: {
        body: input.body,
        bodyData: input.bodyData as object,
        health: input.health,
        id: input.id ?? undefined,
        projectId: input.projectId,
        reactionData: {},
        userId: input.userId,
      },
    });

    // Also update the project's health when a project update is created
    await this.prisma.project.update({
      data: { health: input.health, healthUpdatedAt: new Date() },
      where: { id: input.projectId },
    });

    return update;
  }

  async findProjectUpdateById(id: string): Promise<ProjectUpdate | null> {
    return this.prisma.projectUpdate.findUnique({ where: { id } });
  }

  async getProjectUpdates(projectId: string): Promise<ProjectUpdate[]> {
    return this.prisma.projectUpdate.findMany({
      orderBy: { createdAt: 'desc' },
      where: { archivedAt: null, projectId },
    });
  }

  async updateProjectUpdate(id: string, input: ProjectUpdateUpdateInput): Promise<ProjectUpdate> {
    const data: Record<string, unknown> = { editedAt: new Date() };
    if (input.body !== undefined) {
      data.body = input.body;
    }
    if (input.bodyData !== undefined) {
      data.bodyData = input.bodyData;
    }
    if (input.health !== undefined) {
      data.health = input.health;
    }

    return this.prisma.projectUpdate.update({ data, where: { id } });
  }

  async deleteProjectUpdate(id: string): Promise<ProjectUpdate> {
    return this.prisma.projectUpdate.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async generateUniqueSlugId(
    prisma: PrismaClient,
    name: string,
    organizationId: string,
  ): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const slug = base || 'project';

    const existing = await prisma.project.findFirst({
      where: { organizationId, slugId: slug },
    });

    if (!existing) {
      return slug;
    }

    // Retry with random suffix to avoid concurrent collisions
    for (let i = 0; i < 5; i++) {
      const suffix = Math.random().toString(36).slice(2, 6);
      const candidate = `${slug}-${suffix}`;
      const conflict = await prisma.project.findFirst({
        where: { organizationId, slugId: candidate },
      });
      if (!conflict) {
        return candidate;
      }
    }

    // Final fallback with timestamp + random
    return `${slug}-${Date.now().toString(36)}`;
  }
}
