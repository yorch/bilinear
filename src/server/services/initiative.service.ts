import type { Initiative, InitiativeProject, PrismaClient } from '../../generated/prisma';

export interface InitiativeCreateInput {
  color?: string;
  description?: string;
  icon?: string;
  id?: string;
  name: string;
  ownerId?: string;
  priority?: number;
  projectIds?: string[];
  sortOrder?: number;
  startDate?: string;
  startDateResolution?: string;
  status?: InitiativeStatus;
  targetDate?: string;
  targetDateResolution?: string;
}

export interface InitiativeUpdateInput {
  color?: string;
  description?: string | null;
  icon?: string | null;
  name?: string;
  ownerId?: string | null;
  priority?: number;
  prioritySortOrder?: number;
  sortOrder?: number;
  startDate?: string | null;
  startDateResolution?: string | null;
  status?: InitiativeStatus;
  targetDate?: string | null;
  targetDateResolution?: string | null;
}

export type InitiativeStatus = 'planned' | 'active' | 'completed' | 'canceled';

const VALID_STATUSES = new Set<InitiativeStatus>(['planned', 'active', 'completed', 'canceled']);

/**
 * Lifecycle-timestamp patch applied when transitioning into each status.
 * Stamps the entered status's marker and clears the others so a revert
 * (e.g. canceled → active) doesn't leave stale terminal markers behind.
 * Only the timestamps are listed here; the caller still sets `status`.
 *
 * `startedAt: now` for `active` is set by the caller (Date is created
 * once per update call); this table holds the constants only.
 */
const STATUS_TRANSITION_CLEARS: Record<
  InitiativeStatus,
  {
    startedAt: 'now' | 'clear' | 'leave';
    completedAt: 'clear' | 'now' | 'leave';
    canceledAt: 'clear' | 'now' | 'leave';
  }
> = {
  active: { canceledAt: 'clear', completedAt: 'clear', startedAt: 'now' },
  canceled: { canceledAt: 'now', completedAt: 'clear', startedAt: 'leave' },
  completed: { canceledAt: 'clear', completedAt: 'now', startedAt: 'leave' },
  planned: { canceledAt: 'clear', completedAt: 'clear', startedAt: 'clear' },
};

/**
 * Initiatives are top-level strategic objects that group projects toward a
 * multi-quarter goal. Progress rolls up from associated projects, weighted
 * equally (mean of `Project.progress`). Cached on `Initiative.progress` and
 * recomputed on project add/remove and on demand.
 */
export class InitiativeService {
  constructor(private prisma: PrismaClient) {}

  async create(
    orgId: string,
    creatorId: string,
    input: InitiativeCreateInput,
  ): Promise<Initiative> {
    if (input.status && !VALID_STATUSES.has(input.status)) {
      throw new InitiativeInvalidStatusError();
    }

    return this.prisma.$transaction(async tx => {
      const initiative = await tx.initiative.create({
        data: {
          color: input.color ?? '#6366f1',
          creatorId,
          description: input.description,
          icon: input.icon,
          id: input.id ?? undefined,
          name: input.name,
          organizationId: orgId,
          ownerId: input.ownerId ?? null,
          priority: input.priority ?? 0,
          sortOrder: input.sortOrder ?? 0,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          startDateResolution: input.startDateResolution,
          status: input.status ?? 'planned',
          targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
          targetDateResolution: input.targetDateResolution,
        },
      });

      if (input.projectIds?.length) {
        // Verify all projects belong to the same org before linking.
        // Capture progress on the same query so we can compute the
        // initial rollup inline — without this the returned initiative
        // would carry progress=0 even if every linked project is at
        // 100%, and the create-time SyncAction would broadcast that
        // wrong value.
        const projects = await tx.project.findMany({
          select: { archivedAt: true, id: true, progress: true, trashed: true },
          where: { id: { in: input.projectIds }, organizationId: orgId },
        });
        if (projects.length !== input.projectIds.length) {
          throw new InitiativeProjectNotFoundError();
        }
        await tx.initiativeProject.createMany({
          data: input.projectIds.map((projectId, idx) => ({
            initiativeId: initiative.id,
            projectId,
            sortOrder: idx,
          })),
          skipDuplicates: true,
        });
        const eligible = projects.filter(p => !p.archivedAt && !p.trashed);
        const progress =
          eligible.length === 0
            ? 0
            : eligible.reduce((sum, p) => sum + p.progress, 0) / eligible.length;
        if (progress > 0) {
          return tx.initiative.update({
            data: { progress },
            where: { id: initiative.id },
          });
        }
      }

      return initiative;
    });
  }

  async update(orgId: string, id: string, input: InitiativeUpdateInput): Promise<Initiative> {
    if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
      throw new InitiativeInvalidStatusError();
    }

    const data: Parameters<PrismaClient['initiative']['update']>[0]['data'] = {};
    if (input.name !== undefined) {
      data.name = input.name;
    }
    if ('description' in input) {
      data.description = input.description;
    }
    if ('icon' in input) {
      data.icon = input.icon;
    }
    if (input.color !== undefined) {
      data.color = input.color;
    }
    if ('ownerId' in input) {
      data.ownerId = input.ownerId;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
    }
    if (input.prioritySortOrder !== undefined) {
      data.prioritySortOrder = input.prioritySortOrder;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }
    if ('startDate' in input) {
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if ('startDateResolution' in input) {
      data.startDateResolution = input.startDateResolution;
    }
    if ('targetDate' in input) {
      data.targetDate = input.targetDate ? new Date(input.targetDate) : null;
    }
    if ('targetDateResolution' in input) {
      data.targetDateResolution = input.targetDateResolution;
    }
    if (input.status !== undefined) {
      data.status = input.status;
      const now = new Date();
      const transition = STATUS_TRANSITION_CLEARS[input.status as InitiativeStatus];
      // For startedAt: only stamp `now` when transitioning INTO active from a
      // non-active state, so re-saving an already-active initiative (or
      // bouncing canceled→active) doesn't overwrite the original start.
      const apply = (op: 'now' | 'clear' | 'leave') =>
        op === 'now' ? now : op === 'clear' ? null : undefined;
      let startedAt = apply(transition.startedAt);
      const completedAt = apply(transition.completedAt);
      const canceledAt = apply(transition.canceledAt);
      if (input.status === 'active') {
        const current = await this.prisma.initiative.findFirst({
          select: { startedAt: true, status: true },
          where: { id, organizationId: orgId },
        });
        if (current?.status === 'active' && current.startedAt) {
          startedAt = undefined;
        }
      }
      if (startedAt !== undefined) {
        data.startedAt = startedAt;
      }
      if (completedAt !== undefined) {
        data.completedAt = completedAt;
      }
      if (canceledAt !== undefined) {
        data.canceledAt = canceledAt;
      }
    }

    // updateMany scoped by orgId is the tenant guard — an admin who guesses
    // an initiative id in another org gets a zero-row update, which we
    // surface as NotFound rather than letting it leak through as a 200.
    const claim = await this.prisma.initiative.updateMany({
      data,
      where: { id, organizationId: orgId },
    });
    if (claim.count !== 1) {
      throw new InitiativeNotFoundError();
    }
    const updated = await this.prisma.initiative.findUnique({ where: { id } });
    if (!updated) {
      throw new InitiativeNotFoundError();
    }
    return updated;
  }

  async archive(orgId: string, id: string): Promise<Initiative> {
    const claim = await this.prisma.initiative.updateMany({
      data: { archivedAt: new Date() },
      where: { id, organizationId: orgId },
    });
    if (claim.count !== 1) {
      throw new InitiativeNotFoundError();
    }
    const updated = await this.prisma.initiative.findUnique({ where: { id } });
    if (!updated) {
      throw new InitiativeNotFoundError();
    }
    return updated;
  }

  async delete(orgId: string, id: string): Promise<Initiative> {
    const existing = await this.findById(orgId, id);
    if (!existing) {
      throw new InitiativeNotFoundError();
    }
    return this.prisma.initiative.delete({ where: { id } });
  }

  async findById(orgId: string, id: string): Promise<Initiative | null> {
    return this.prisma.initiative.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  async findByOrgId(orgId: string, includeArchived = false): Promise<Initiative[]> {
    return this.prisma.initiative.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        organizationId: orgId,
      },
    });
  }

  /**
   * Add a project to this initiative. No-op if the link already exists.
   * Verifies both initiative and project belong to `orgId` before linking
   * so this method can be called directly from a resolver without an
   * out-of-band tenant check.
   */
  async addProject(
    orgId: string,
    initiativeId: string,
    projectId: string,
  ): Promise<InitiativeProject> {
    const [initiative, project] = await Promise.all([
      this.prisma.initiative.findFirst({
        select: { id: true },
        where: { id: initiativeId, organizationId: orgId },
      }),
      this.prisma.project.findFirst({
        select: { id: true },
        where: { id: projectId, organizationId: orgId },
      }),
    ]);
    if (!initiative) {
      throw new InitiativeNotFoundError();
    }
    if (!project) {
      throw new InitiativeProjectNotFoundError();
    }
    const link = await this.prisma.initiativeProject.upsert({
      create: { initiativeId, projectId },
      update: {},
      where: { initiativeId_projectId: { initiativeId, projectId } },
    });
    await this.recomputeProgress(initiativeId);
    return link;
  }

  /**
   * Remove a project link. Idempotent — silently no-ops if the link is
   * already gone. Returns the deleted link id (or null) so the resolver
   * can emit a `'D' InitiativeProject` SyncAction.
   */
  async removeProject(initiativeId: string, projectId: string): Promise<string | null> {
    let removedId: string | null = null;
    try {
      const removed = await this.prisma.initiativeProject.delete({
        where: { initiativeId_projectId: { initiativeId, projectId } },
      });
      removedId = removed.id;
    } catch {
      // Already removed — idempotent.
    }
    await this.recomputeProgress(initiativeId);
    return removedId;
  }

  /**
   * Project ids linked to the initiative, ordered by `sortOrder`. Used
   * by the `Initiative.projects` GraphQL field, which then loads the
   * full Project rows via DataLoader so callers see the complete shape
   * (slugId, color, statusType, etc.) — not just the truncated subset
   * `getProjects` returns.
   */
  async getProjectIds(initiativeId: string): Promise<string[]> {
    const links = await this.prisma.initiativeProject.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { projectId: true },
      where: { initiativeId },
    });
    return links.map(l => l.projectId);
  }

  /** Linked projects ordered by sortOrder. */
  async getProjects(
    initiativeId: string,
  ): Promise<
    Array<InitiativeProject & { project: { id: string; name: string; progress: number } }>
  > {
    return this.prisma.initiativeProject.findMany({
      include: {
        project: {
          select: { id: true, name: true, progress: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
      where: { initiativeId },
    });
  }

  /** Initiatives that include a given project. */
  async getInitiativesForProject(projectId: string): Promise<Initiative[]> {
    const links = await this.prisma.initiativeProject.findMany({
      include: { initiative: true },
      where: { initiative: { archivedAt: null }, projectId },
    });
    return links.map(l => l.initiative);
  }

  /**
   * Recompute and persist `Initiative.progress` as the mean progress of all
   * non-archived linked projects. Returns the updated initiative row so the
   * caller can emit a `'U' Initiative` SyncAction. Returns `null` if the
   * initiative no longer exists (e.g. deleted during a project event), or
   * if the recomputed value is unchanged (no-op skip — saves a wasteful
   * SyncAction broadcast on the common projectUpdate path).
   */
  async recomputeProgress(initiativeId: string): Promise<Initiative | null> {
    const [links, current] = await Promise.all([
      this.prisma.initiativeProject.findMany({
        include: {
          project: {
            select: { archivedAt: true, progress: true, trashed: true },
          },
        },
        where: { initiativeId },
      }),
      this.prisma.initiative.findUnique({
        select: { progress: true },
        where: { id: initiativeId },
      }),
    ]);
    if (!current) {
      return null;
    }
    const eligible = links.filter(l => l.project && !l.project.archivedAt && !l.project.trashed);
    const progress =
      eligible.length === 0
        ? 0
        : eligible.reduce((sum, l) => sum + (l.project?.progress ?? 0), 0) / eligible.length;

    // Skip the write when the rolled-up value didn't actually move.
    // 1e-9 tolerance covers floating-point round-trip jitter.
    if (Math.abs(progress - current.progress) < 1e-9) {
      return null;
    }

    try {
      return await this.prisma.initiative.update({
        data: { progress },
        where: { id: initiativeId },
      });
    } catch {
      return null;
    }
  }
}

export class InitiativeNotFoundError extends Error {
  constructor() {
    super('Initiative not found');
    this.name = 'InitiativeNotFoundError';
  }
}

export class InitiativeInvalidStatusError extends Error {
  constructor() {
    super('Initiative status must be one of: planned, active, completed, canceled');
    this.name = 'InitiativeInvalidStatusError';
  }
}

export class InitiativeProjectNotFoundError extends Error {
  constructor() {
    super('One or more projects not found in this organization');
    this.name = 'InitiativeProjectNotFoundError';
  }
}
