import type {
  Initiative,
  InitiativeProject,
  InitiativeUpdate,
  PrismaClient,
} from '../../generated/prisma';
import { assertMaxLength, MAX_RICH_TEXT_LENGTH } from '../lib/limits';
import {
  applyStatusTransitionTimestamps,
  type StatusTimestampTransition,
} from '../lib/status-timestamps';
import { ProjectService } from './project.service';

export interface InitiativeCreateInput {
  color?: string;
  description?: string;
  icon?: string;
  id?: string;
  name: string;
  ownerId?: string;
  parentId?: string;
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
  parentId?: string | null;
  priority?: number;
  prioritySortOrder?: number;
  sortOrder?: number;
  startDate?: string | null;
  startDateResolution?: string | null;
  status?: InitiativeStatus;
  targetDate?: string | null;
  targetDateResolution?: string | null;
}

/**
 * Default max nesting depth for sub-initiatives. Past this the breadcrumb in
 * the detail panel becomes unreadable and the recursive progress rollup
 * starts to dominate the project-update hot path. Matches Linear's
 * Enterprise plan cap. The enforced value is read per-org from
 * `Organization.maxInitiativeDepth` (see `assertParentAcceptsChild`) — this
 * constant only documents the default and backs the fallback / error message
 * when the org row can't be read.
 */
export const MAX_INITIATIVE_DEPTH = 5;

export type InitiativeStatus = 'planned' | 'active' | 'completed' | 'canceled';

const VALID_STATUSES = new Set<InitiativeStatus>(['planned', 'active', 'completed', 'canceled']);

// Server-side cap on initiative description length — shares the app-wide
// rich-text cap (see ../lib/limits) so a malicious or buggy client can't
// push a multi-megabyte payload through initiative create/update.
function assertValidDescription(description: string | null | undefined): void {
  assertMaxLength(
    description,
    MAX_RICH_TEXT_LENGTH,
    msg => new InitiativeValidationError(msg),
    'description',
  );
}

/**
 * Lifecycle-timestamp patch applied when transitioning into each status.
 * Stamps the entered status's marker and clears the others so a revert
 * (e.g. canceled → active) doesn't leave stale terminal markers behind.
 * Only the timestamps are listed here; the caller still sets `status`.
 *
 * `startedAt: now` for `active` is set by the caller (Date is created
 * once per update call); this table holds the constants only. Applied via
 * the shared `applyStatusTransitionTimestamps` helper (see
 * `src/server/lib/status-timestamps.ts`), also used by
 * `ProjectService.update` with its own status-keyed table.
 */
const STATUS_TRANSITION_CLEARS: Record<InitiativeStatus, StatusTimestampTransition> = {
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
  constructor(
    private prisma: PrismaClient,
    // Defaults to a fresh ProjectService over the same prisma client for
    // call sites that construct InitiativeService standalone (e.g. test
    // helpers) — real wiring (src/server/graphql/context.ts) passes its own
    // already-constructed ProjectService instance explicitly.
    private project: ProjectService = new ProjectService(prisma),
  ) {}

  async create(
    orgId: string,
    creatorId: string,
    input: InitiativeCreateInput,
  ): Promise<Initiative> {
    if (input.status && !VALID_STATUSES.has(input.status)) {
      throw new InitiativeInvalidStatusError();
    }
    assertValidDescription(input.description);

    // Verify parent exists in this org and that the resulting depth is
    // within the cap. Both checks run before the create so we never end up
    // with a parented row that violates the depth invariant.
    if (input.parentId) {
      await this.assertParentAcceptsChild(orgId, input.parentId, null);
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
          parentId: input.parentId ?? null,
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
        const projects = await tx.project.findMany({
          select: { archivedAt: true, id: true, trashed: true },
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
        // Compute the initial rollup inline so the returned initiative
        // doesn't carry progress=0 even when every linked project is at
        // 100% (and the create-time SyncAction would broadcast that wrong
        // value). `Project.progress` is a dead column — nothing writes
        // it — so the real value is fetched live, batched over every
        // linked project id in one pair of queries (see
        // `ProjectService.getProgressBatch`) instead of one
        // `ProjectService.getProgress()` round-trip per project.
        const progressByProject = await this.project.getProgressBatch(eligible.map(p => p.id));
        const progresses = eligible.map(
          p => progressByProject.get(p.id) ?? { progress: 0, scope: 0 },
        );
        const progress =
          progresses.length === 0
            ? 0
            : progresses.reduce((sum, p) => sum + p.progress, 0) / progresses.length;
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
    assertValidDescription(input.description);

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
    if ('parentId' in input) {
      // Re-parenting: verify the new parent exists in this org, isn't the
      // initiative itself, isn't a descendant of it (would create a
      // cycle), and that the resulting depth is still within the cap.
      if (input.parentId) {
        await this.assertParentAcceptsChild(orgId, input.parentId, id);
      }
      data.parentId = input.parentId;
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
      const patch = applyStatusTransitionTimestamps(
        STATUS_TRANSITION_CLEARS,
        input.status as InitiativeStatus,
        now,
      );
      // For startedAt: only stamp `now` when transitioning INTO active from a
      // non-active state, so re-saving an already-active initiative (or
      // bouncing canceled→active) doesn't overwrite the original start.
      let startedAt = patch.startedAt;
      const completedAt = patch.completedAt;
      const canceledAt = patch.canceledAt;
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
    // Recompute progress is the caller's responsibility (via
    // recomputeProgressCascade) so ancestor SyncActions reach the wire.
    // Calling it here would emit only the directly-affected row.
    return link;
  }

  /**
   * Remove a project link. Idempotent — silently no-ops if the link is
   * already gone. Returns the deleted link id (or null) so the resolver
   * can emit a `'D' InitiativeProject` SyncAction. As with `addProject`,
   * the caller drives `recomputeProgressCascade` for SyncAction emission.
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
   * Backwards-compatible alias of `recomputeProgressCascade` that returns
   * only the directly-recomputed row. Prefer the cascade form in new code
   * so ancestor changes also reach the SyncAction stream — without that,
   * connected clients see stale parent.progress until next bootstrap.
   *
   * Existing callers that don't emit SyncActions for the returned
   * ancestors are listed in PATTERNS.md §46.
   */
  async recomputeProgress(initiativeId: string): Promise<Initiative | null> {
    const { self } = await this.recomputeProgressCascade(initiativeId);
    return self;
  }

  /**
   * Recompute and persist `Initiative.progress` as the mean progress of
   * non-archived linked projects AND non-archived child initiatives,
   * weighted equally. Then walk up the parent chain, recomputing each
   * ancestor the same way, stopping naturally when a level reports
   * "no change" (rounded progress is identical).
   *
   * Returns `{ self, ancestors }` so the caller can emit one SyncAction
   * per updated row — broadcasting only `self` would let ancestor
   * progress drift silently on connected clients.
   *
   * `self` is null if the initiative no longer exists or its progress
   * didn't move. `ancestors` are ordered nearest-first (parent, then
   * grandparent, …).
   */
  async recomputeProgressCascade(
    initiativeId: string,
  ): Promise<{ self: Initiative | null; ancestors: Initiative[] }> {
    const self = await this.recomputeProgressOnce(initiativeId);
    if (!self) {
      return { ancestors: [], self: null };
    }

    // Walk up one ancestor at a time, recomputing each in isolation.
    // Iterative (no recursion into recomputeProgressCascade) so the
    // outer caller gets every changed ancestor in one collected list —
    // a recursive form throws away the inner call's ancestors.
    // Visited set defends against cyclic ancestor chains in bad data.
    const ancestors: Initiative[] = [];
    const visited = new Set<string>([initiativeId]);
    let cursor: string | null = self.parentId;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const ancestor: Initiative | null = await this.recomputeProgressOnce(cursor);
      if (!ancestor) {
        break;
      }
      ancestors.push(ancestor);
      cursor = ancestor.parentId;
    }
    return { ancestors, self };
  }

  /**
   * Single-step progress recompute for one initiative — does NOT walk
   * the parent chain. Returns the updated row, or null when:
   *   - the initiative doesn't exist
   *   - the recomputed value is unchanged (no-op skip)
   *   - the update query failed (deleted mid-flight, etc.)
   *
   * Used as the building block for `recomputeProgressCascade`. Kept
   * separate so the cascade can be iterative — letting one method
   * both write self and recurse loses ancestor rows.
   */
  private async recomputeProgressOnce(initiativeId: string): Promise<Initiative | null> {
    // The `?? []` wrapper around `prisma.initiative.findMany` accommodates
    // existing service-level test mocks that don't stub this call. Prisma
    // itself always returns a Promise — the wrapper is defensive against
    // `vi.fn()` returning undefined synchronously. Replaced by typed mocks
    // when the wider mock-prisma refactor lands; see TODO in test/prisma-mock.ts.
    const childrenPromise: Promise<Array<{ archivedAt: Date | null; progress: number }>> =
      Promise.resolve(
        (this.prisma.initiative.findMany({
          select: { archivedAt: true, progress: true },
          where: { archivedAt: null, parentId: initiativeId },
        }) as unknown as
          | Promise<Array<{ archivedAt: Date | null; progress: number }>>
          | undefined) ?? [],
      );

    const [links, children, current] = await Promise.all([
      this.prisma.initiativeProject.findMany({
        select: {
          project: {
            select: { archivedAt: true, trashed: true },
          },
          projectId: true,
        },
        where: { initiativeId },
      }),
      childrenPromise,
      this.prisma.initiative.findUnique({
        select: { parentId: true, progress: true },
        where: { id: initiativeId },
      }),
    ]);
    if (!current) {
      return null;
    }
    const eligible = links.filter(l => l.project && !l.project.archivedAt && !l.project.trashed);
    const eligibleChildren = (children ?? []).filter(c => !c.archivedAt);

    // `Project.progress` is a dead column — nothing writes it. The real
    // value is computed live from issue completion, batched over every
    // linked project id in one pair of groupBy queries (see
    // `ProjectService.getProgressBatch`) rather than 2 issue.count queries
    // PER linked project (an N+1 that used to run on every project/issue
    // mutation via the recompute cascade).
    const progressByProject = await this.project.getProgressBatch(eligible.map(l => l.projectId));
    const projectProgresses = eligible.map(
      l => progressByProject.get(l.projectId) ?? { progress: 0, scope: 0 },
    );

    const totalCount = eligible.length + eligibleChildren.length;
    const progress =
      totalCount === 0
        ? 0
        : (projectProgresses.reduce((sum, p) => sum + p.progress, 0) +
            eligibleChildren.reduce((sum, c) => sum + c.progress, 0)) /
          totalCount;

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

  /**
   * Guard for re-parenting / parenting on create. Checks: parent exists in
   * the org, isn't the initiative itself, isn't a descendant (cycle), and
   * the resulting depth doesn't exceed MAX_INITIATIVE_DEPTH. `childId`
   * may be null on create.
   */
  private async assertParentAcceptsChild(
    orgId: string,
    parentId: string,
    childId: string | null,
  ): Promise<void> {
    if (childId && parentId === childId) {
      throw new InitiativeInvalidParentError();
    }
    // Fetched once per call (not per recursion level below) — the org's
    // plan-tier depth cap (Organization.maxInitiativeDepth) doesn't change
    // mid-walk, so there's no reason to re-read it on every ancestor hop.
    const org = await this.prisma.organization.findUnique({
      select: { maxInitiativeDepth: true },
      where: { id: orgId },
    });
    const maxDepth = org?.maxInitiativeDepth ?? MAX_INITIATIVE_DEPTH;

    const parent = await this.prisma.initiative.findFirst({
      select: { id: true, parentId: true },
      where: { id: parentId, organizationId: orgId },
    });
    if (!parent) {
      throw new InitiativeNotFoundError();
    }
    // Walk up to root, counting depth and detecting cycles.
    let cursor: { id: string; parentId: string | null } | null = parent;
    let depth = 1;
    // Baseline check: if the target parent already sits at (or beyond) the
    // cap, no child can be attached — even when the parent is itself a root
    // (parentId === null), in which case the loop below never runs. Without
    // this, a per-org `maxInitiativeDepth = 1` (forbid all nesting) would be
    // silently ignored for a root parent.
    if (depth >= maxDepth) {
      throw new InitiativeMaxDepthError(maxDepth);
    }
    const seen = new Set<string>([parent.id]);
    while (cursor?.parentId) {
      if (childId && cursor.parentId === childId) {
        // Would create a cycle: childId is already an ancestor of parent.
        throw new InitiativeInvalidParentError();
      }
      if (seen.has(cursor.parentId)) {
        // Existing data is already cyclic — refuse rather than loop forever.
        throw new InitiativeInvalidParentError();
      }
      seen.add(cursor.parentId);
      depth += 1;
      if (depth >= maxDepth) {
        throw new InitiativeMaxDepthError(maxDepth);
      }
      const next: { id: string; parentId: string | null } | null =
        await this.prisma.initiative.findUnique({
          select: { id: true, parentId: true },
          where: { id: cursor.parentId },
        });
      cursor = next;
    }
  }

  // ─── Initiative Updates ──────────────────────────────────────────────────

  async createInitiativeUpdate(input: {
    body: string;
    bodyData: Record<string, unknown>;
    health: string;
    id?: string;
    initiativeId: string;
    userId: string;
  }): Promise<InitiativeUpdate> {
    return this.prisma.initiativeUpdate.create({
      data: {
        body: input.body,
        bodyData: input.bodyData as object,
        health: input.health,
        id: input.id ?? undefined,
        initiativeId: input.initiativeId,
        userId: input.userId,
      },
    });
  }

  async updateInitiativeUpdate(
    id: string,
    input: {
      body?: string;
      bodyData?: Record<string, unknown>;
      health?: string;
    },
  ): Promise<InitiativeUpdate> {
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
    return this.prisma.initiativeUpdate.update({ data, where: { id } });
  }

  async deleteInitiativeUpdate(id: string): Promise<InitiativeUpdate> {
    return this.prisma.initiativeUpdate.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async findInitiativeUpdateById(id: string): Promise<InitiativeUpdate | null> {
    return this.prisma.initiativeUpdate.findUnique({ where: { id } });
  }

  async getInitiativeUpdates(initiativeId: string): Promise<InitiativeUpdate[]> {
    return this.prisma.initiativeUpdate.findMany({
      orderBy: { createdAt: 'desc' },
      where: { archivedAt: null, initiativeId },
    });
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

export class InitiativeInvalidParentError extends Error {
  constructor() {
    super('Initiative parent cannot be itself or one of its descendants');
    this.name = 'InitiativeInvalidParentError';
  }
}

export class InitiativeMaxDepthError extends Error {
  constructor(maxDepth: number = MAX_INITIATIVE_DEPTH) {
    super(`Initiative nesting depth cannot exceed ${maxDepth}`);
    this.name = 'InitiativeMaxDepthError';
  }
}

/** A description value violates the server-side input length cap. */
export class InitiativeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitiativeValidationError';
  }
}
