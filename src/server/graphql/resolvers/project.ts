import { GraphQLError } from 'graphql';
import type {
  Project,
  ProjectMilestone,
  ProjectUpdate,
} from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
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
  const cache = ((ctx as unknown as Record<symbol, unknown>)[
    progressCacheKey
  ] ??= new Map<string, Promise<{ progress: number; scope: number }>>()) as Map<
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

    projectArchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const project = await ctx.services.project.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'Project',
        id,
        project,
      );
      return { lastSyncId: sync.id.toString(), project, success: true };
    },
    projectCreate: async (
      _parent: unknown,
      { input }: { input: ProjectCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const project = await ctx.services.project.create(
        ctx.orgId,
        ctx.userId,
        input,
      );
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'Project',
        project.id,
        project,
      );
      return { lastSyncId: sync.id.toString(), project, success: true };
    },

    projectDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.project.delete(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'Project',
        id,
        null,
      );
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
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Project',
        id,
        project,
      );
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

    projectUpdateDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.project.findProjectUpdateById(id);
      if (!existing) {
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
      if (!project.creatorId) return null;
      return ctx.services.user.findById(project.creatorId);
    },

    issues: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      return ctx.prisma.issue.findMany({
        orderBy: { sortOrder: 'asc' },
        where: { archivedAt: null, projectId: project.id, trashed: false },
      });
    },

    lead: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      if (!project.leadId) return null;
      return ctx.services.user.findById(project.leadId);
    },

    members: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.project.getMembers(project.id);
    },

    milestones: async (
      project: Project,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      return ctx.services.project.getMilestones(project.id);
    },

    progress: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      const result = await getProgressCached(ctx, project.id);
      return result.progress;
    },

    scope: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      const result = await getProgressCached(ctx, project.id);
      return result.scope;
    },

    teams: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.project.getTeams(project.id);
    },

    updates: async (project: Project, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.project.getProjectUpdates(project.id);
    },
  },

  ProjectMilestone: {},

  ProjectUpdate: {
    user: async (
      update: ProjectUpdate,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      return ctx.services.user.findById(update.userId);
    },
  },

  Query: {
    project: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
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
        if (idx >= 0) start = idx + 1;
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
