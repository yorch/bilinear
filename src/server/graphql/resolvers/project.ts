import { GraphQLError } from 'graphql';
import type { Project, ProjectUpdate } from '../../../generated/prisma';
import { logger } from '../../lib/logger';
import { getGuestTeamIds, requireAuth, requireOrgRole } from '../../middleware/auth';
import { IssueService } from '../../services/issue.service';
import type {
  ProjectCreateInput,
  ProjectMilestoneCreateInput,
  ProjectMilestoneUpdateInput,
  ProjectUpdateCreateInput,
  ProjectUpdateInput,
  ProjectUpdateUpdateInput,
} from '../../services/project.service';
import type { GraphQLContext } from '../context';

// Per-request cache to avoid duplicate getProgress calls when both progress and scope are queried
const progressCacheKey = Symbol('projectProgress');

function getProgressCached(
  ctx: GraphQLContext,
  projectId: string,
): Promise<{ progress: number; scope: number }> {
  const ctxRecord = ctx as unknown as Record<symbol, unknown>;
  if (!ctxRecord[progressCacheKey]) {
    ctxRecord[progressCacheKey] = new Map<string, Promise<{ progress: number; scope: number }>>();
  }
  const cache = ctxRecord[progressCacheKey] as Map<
    string,
    Promise<{ progress: number; scope: number }>
  >;

  let promise = cache.get(projectId);
  if (!promise) {
    promise = ctx.services.project.getProgress(projectId);
    cache.set(projectId, promise);
  }
  return promise;
}

export const projectResolvers = {
  Mutation: {
    projectAddMember: async (
      _parent: unknown,
      { projectId, userId }: { projectId: string; userId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(projectId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      // Restructuring a project's membership is not a guest capability.
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin', 'member']);

      const isOrgMember = await ctx.services.organization.isMember(ctx.orgId, userId);
      if (!isOrgMember) {
        throw new GraphQLError('User is not a member of this organization', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.project.addMember(projectId, userId);
      const project = await ctx.services.project.findById(projectId);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Project',
        projectId,
        project,
      );
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    projectAddTeam: async (
      _parent: unknown,
      { projectId, teamId }: { projectId: string; teamId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(projectId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin', 'member']);

      const team = await ctx.services.team.findById(teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.project.addTeam(projectId, teamId);
      const project = await ctx.services.project.findById(projectId);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Project',
        projectId,
        project,
      );
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    projectArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const project = await ctx.services.project.archive(id);
      let sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'A', 'Project', id, project);
      // Archiving a project effectively removes it from initiative
      // progress calculations (recomputeProgress filters out archived
      // projects). Update each linked initiative so the rollup stays
      // current.
      const initiatives = await ctx.services.initiative.getInitiativesForProject(id);
      for (const init of initiatives) {
        // Cascade up the parent chain — without this, ancestor progress
        // drifts on connected clients until next bootstrap (see
        // PATTERNS.md §46).
        const { self, ancestors } = await ctx.services.initiative.recomputeProgressCascade(init.id);
        for (const updated of [self, ...ancestors].filter(
          (i): i is NonNullable<typeof i> => i !== null,
        )) {
          sync = await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'U',
            'Initiative',
            updated.id,
            updated,
          );
        }
      }
      return { lastSyncId: sync.id.toString(), project, success: true };
    },
    projectCreate: async (
      _parent: unknown,
      { input }: { input: ProjectCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      if (input.teamIds && input.teamIds.length > 0) {
        try {
          await ctx.services.team.assertAllInOrg(input.teamIds, ctx.orgId);
        } catch (err) {
          const error = err as Error;
          if (error.name === 'TeamNotFoundError') {
            throw new GraphQLError('One or more teams not found', {
              extensions: { code: 'NOT_FOUND' },
            });
          }
          if (error.name === 'TeamCrossOrgError') {
            throw new GraphQLError(error.message, {
              extensions: { code: 'FORBIDDEN' },
            });
          }
          throw err;
        }
      }

      const project = await ctx.services.project.create(ctx.orgId, ctx.userId, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'Project',
        project.id,
        project,
      );
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'project.created', project)
        .catch(err => logger.error({ err }, 'webhook dispatch failed: project.created'));
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    projectDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // ProjectService.delete is a soft-delete (sets archivedAt + trashed),
      // so the InitiativeProject rows still exist in Postgres. We must NOT
      // emit `'D' InitiativeProject` sync actions — clients that drop the
      // rows would see them reappear on next bootstrap. recomputeProgress
      // already filters archived+trashed projects out of the rollup, and
      // the project store's `.all` getter hides them from list views.
      const initiatives = await ctx.services.initiative.getInitiativesForProject(id);

      await ctx.services.project.delete(id);
      let sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Project', id, null);
      for (const init of initiatives) {
        const { self, ancestors } = await ctx.services.initiative.recomputeProgressCascade(init.id);
        for (const updated of [self, ...ancestors].filter(
          (i): i is NonNullable<typeof i> => i !== null,
        )) {
          sync = await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'U',
            'Initiative',
            updated.id,
            updated,
          );
        }
      }
      return { lastSyncId: sync.id.toString(), success: true };
    },

    // ─── Milestones ──────────────────────────────────────────────────────────

    projectMilestoneCreate: async (
      _parent: unknown,
      { input }: { input: ProjectMilestoneCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const project = await ctx.services.project.findById(input.projectId);
      if (!project || project.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const milestone = await ctx.services.project.createMilestone(input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'ProjectMilestone',
        milestone.id,
        milestone,
      );
      return {
        lastSyncId: sync.id.toString(),
        projectMilestone: milestone,
        success: true,
      };
    },

    projectMilestoneDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findMilestoneById(id);
      if (!existing) {
        throw new GraphQLError('Milestone not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const milestoneProject = await ctx.services.project.findById(existing.projectId);
      if (!milestoneProject || milestoneProject.organizationId !== ctx.orgId) {
        throw new GraphQLError('Milestone not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.project.deleteMilestone(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'ProjectMilestone',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },

    projectMilestoneUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: ProjectMilestoneUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findMilestoneById(id);
      if (!existing) {
        throw new GraphQLError('Milestone not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const milestoneProject = await ctx.services.project.findById(existing.projectId);
      if (!milestoneProject || milestoneProject.organizationId !== ctx.orgId) {
        throw new GraphQLError('Milestone not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const milestone = await ctx.services.project.updateMilestone(id, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'ProjectMilestone',
        id,
        milestone,
      );
      return {
        lastSyncId: sync.id.toString(),
        projectMilestone: milestone,
        success: true,
      };
    },

    projectRemoveMember: async (
      _parent: unknown,
      { projectId, userId }: { projectId: string; userId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(projectId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin', 'member']);

      await ctx.services.project.removeMember(projectId, userId);
      const project = await ctx.services.project.findById(projectId);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Project',
        projectId,
        project,
      );
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    projectRemoveTeam: async (
      _parent: unknown,
      { projectId, teamId }: { projectId: string; teamId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(projectId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin', 'member']);

      await ctx.services.project.removeTeam(projectId, teamId);
      const project = await ctx.services.project.findById(projectId);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Project',
        projectId,
        project,
      );
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    projectUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: ProjectUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const project = await ctx.services.project.update(id, input);
      let sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Project', id, project);
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'project.updated', project)
        .catch(err => logger.error({ err }, 'webhook dispatch failed: project.updated'));

      // A project's statusType feeds initiative roll-up — recompute every
      // linked initiative when it changes. Each recomputed initiative gets its
      // own SyncAction so remote clients see the change without a full
      // bootstrap.
      //
      // NOTE: we intentionally do NOT compare `progress` here — `Project.update`
      // never writes the stored `progress` column (it is recomputed on read),
      // so `existing.progress === project.progress` always. Progress actually
      // moves when an issue's state changes, which today does not cascade to
      // initiative roll-up; that gap is tracked in REVIEW_BACKLOG (§ initiative
      // progress refresh on issue change) because doing it on every issue
      // mutation needs a perf pass first.
      if (existing.statusType !== project.statusType) {
        const initiatives = await ctx.services.initiative.getInitiativesForProject(id);
        for (const init of initiatives) {
          const { self, ancestors } = await ctx.services.initiative.recomputeProgressCascade(
            init.id,
          );
          for (const updated of [self, ...ancestors].filter(
            (i): i is NonNullable<typeof i> => i !== null,
          )) {
            sync = await ctx.services.sync.createSyncAction(
              ctx.orgId,
              'U',
              'Initiative',
              updated.id,
              updated,
            );
          }
        }
      }
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    // ─── Project Updates ─────────────────────────────────────────────────────

    projectUpdateCreate: async (
      _parent: unknown,
      { input }: { input: ProjectUpdateCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const project = await ctx.services.project.findById(input.projectId);
      if (!project || project.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const update = await ctx.services.project.createProjectUpdate({
        ...input,
        userId: ctx.userId,
      });
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'ProjectUpdate',
        update.id,
        update,
      );
      return {
        lastSyncId: sync.id.toString(),
        projectUpdate: update,
        success: true,
      };
    },

    projectUpdateDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findProjectUpdateById(id);
      if (!existing) {
        throw new GraphQLError('Project update not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const updateProject = await ctx.services.project.findById(existing.projectId);
      if (!updateProject || updateProject.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project update not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.project.deleteProjectUpdate(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'ProjectUpdate',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },

    projectUpdateUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: ProjectUpdateUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findProjectUpdateById(id);
      if (!existing) {
        throw new GraphQLError('Project update not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const updateProject = await ctx.services.project.findById(existing.projectId);
      if (!updateProject || updateProject.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project update not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const update = await ctx.services.project.updateProjectUpdate(id, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'ProjectUpdate',
        id,
        update,
      );
      return {
        lastSyncId: sync.id.toString(),
        projectUpdate: update,
        success: true,
      };
    },
  },

  Project: {
    creator: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      if (!project.creatorId) {
        return null;
      }
      return ctx.loaders.user.load(project.creatorId);
    },

    issues: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      // Guest visibility: if the caller is a guest on ANY team in their
      // org, narrow results so they only see issues from non-guest teams
      // PLUS issues they created or are assigned to in guest teams.
      //
      // Snooze hide is applied uniformly via IssueService.snoozeHideClause
      // — without it, Project.issues is a backdoor that surfaces snoozed
      // rows the top-level `issues` query would hide.
      const userId = ctx.userId;
      const orgId = ctx.orgId;
      const guestTeamIds = userId && orgId ? await getGuestTeamIds(ctx.prisma, userId, orgId) : [];
      const ands: Array<Record<string, unknown>> = [IssueService.snoozeHideClause()];
      if (guestTeamIds.length > 0 && userId) {
        ands.push({
          OR: [{ teamId: { notIn: guestTeamIds } }, { creatorId: userId }, { assigneeId: userId }],
        });
      }
      return ctx.prisma.issue.findMany({
        orderBy: { sortOrder: 'asc' },
        where: {
          AND: ands,
          archivedAt: null,
          projectId: project.id,
          trashed: false,
        },
      });
    },

    lead: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      if (!project.leadId) {
        return null;
      }
      return ctx.loaders.user.load(project.leadId);
    },

    members: async (project: Project, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.project.getMembers(project.id),

    milestones: async (project: Project, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.project.getMilestones(project.id),

    progress: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      const result = await getProgressCached(ctx, project.id);
      return result.progress;
    },

    progressHistory: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      const snapshot = await ctx.services.project.recordProgressSnapshotIfStale(project.id);
      // Each history array is daily-aligned by `t`; merge them on date so the
      // client receives one row per day with all four metrics.
      const byDate = new Map<
        string,
        {
          completedIssueCount: number;
          issueCount: number;
          completedScope: number;
          scope: number;
        }
      >();
      const ensure = (t: string) => {
        let row = byDate.get(t);
        if (!row) {
          row = { completedIssueCount: 0, completedScope: 0, issueCount: 0, scope: 0 };
          byDate.set(t, row);
        }
        return row;
      };
      for (const e of snapshot.completedIssueCountHistory) {
        ensure(e.t).completedIssueCount = e.v;
      }
      for (const e of snapshot.issueCountHistory) {
        ensure(e.t).issueCount = e.v;
      }
      for (const e of snapshot.completedScopeHistory) {
        ensure(e.t).completedScope = e.v;
      }
      for (const e of snapshot.scopeHistory) {
        ensure(e.t).scope = e.v;
      }
      return Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v }));
    },

    scope: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      const result = await getProgressCached(ctx, project.id);
      return result.scope;
    },

    teams: async (project: Project, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.project.getTeams(project.id),

    updates: async (project: Project, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.project.getProjectUpdates(project.id),
  },

  ProjectMilestone: {},

  ProjectUpdate: {
    user: async (update: ProjectUpdate, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.user.load(update.userId),
  },

  Query: {
    project: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const project = await ctx.services.project.findById(id);
      if (!project || project.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return project;
    },

    projects: async (
      _parent: unknown,
      args: {
        filter?: { statusType?: string; health?: string; leadId?: string };
        first?: number;
        after?: string;
        includeArchived?: boolean;
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const filtered = await ctx.services.project.findByOrgId(
        ctx.orgId,
        args.includeArchived ?? false,
        args.filter,
      );

      // Cursor pagination
      let start = 0;
      if (args.after) {
        const idx = filtered.findIndex(p => p.id === args.after);
        if (idx >= 0) {
          start = idx + 1;
        }
      }
      const limit = args.first ?? 50;
      const page = filtered.slice(start, start + limit);

      return {
        edges: page.map(p => ({ cursor: p.id, node: p })),
        nodes: page,
        pageInfo: {
          endCursor: page[page.length - 1]?.id ?? null,
          hasNextPage: start + limit < filtered.length,
          hasPreviousPage: start > 0,
          startCursor: page[0]?.id ?? null,
        },
        totalCount: filtered.length,
      };
    },
  },
};
