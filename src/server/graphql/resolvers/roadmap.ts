import { GraphQLError } from 'graphql';
import { requireAuth } from '../../middleware/auth';
import type { RoadmapUpsertInput } from '../../services/roadmap.service';
import {
  RoadmapNotFoundError,
  RoadmapPasswordError,
  RoadmapSlugConflictError,
} from '../../services/roadmap.service';
import type { GraphQLContext } from '../context';

export const roadmapResolvers = {
  Mutation: {
    projectSetRoadmapVisible: async (
      _parent: unknown,
      { id, visible }: { id: string; visible: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const project = await ctx.services.project.findById(id);
      if (!project || project.organizationId !== ctx.orgId) {
        throw new GraphQLError('Project not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const updated = await ctx.prisma.project.update({
        data: { roadmapVisible: visible },
        where: { id },
      });

      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Project',
        id,
        updated,
      );
      return {
        lastSyncId: sync.id.toString(),
        project: updated,
        success: true,
      };
    },

    publicRoadmapUpsert: async (
      _parent: unknown,
      { input }: { input: RoadmapUpsertInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const member = await ctx.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: ctx.orgId,
            userId: ctx.userId,
          },
        },
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        throw new GraphQLError(
          'Only organization admins can manage the public roadmap',
          {
            extensions: { code: 'FORBIDDEN' },
          },
        );
      }

      const org = await ctx.prisma.organization.findUnique({
        where: { id: ctx.orgId },
      });

      try {
        const roadmap = await ctx.services.roadmap.upsert(
          ctx.orgId,
          org?.urlKey ?? ctx.orgId,
          input,
        );
        // PublicRoadmap is a workspace-only setting — no client-side sync store.
        // Return the current lastSyncId without creating a spurious sync action.
        const lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
        return {
          lastSyncId: lastSyncId.toString(),
          roadmap: { ...roadmap, hasPassword: !!roadmap.passwordHash },
          success: true,
        };
      } catch (err) {
        if (err instanceof RoadmapSlugConflictError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },
  },

  Query: {
    publicRoadmap: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const roadmap = await ctx.services.roadmap.findByOrgId(ctx.orgId);
      if (!roadmap) {
        return null;
      }
      return { ...roadmap, hasPassword: !!roadmap.passwordHash };
    },

    publicRoadmapPage: async (
      _parent: unknown,
      { password, slug }: { password?: string; slug: string },
      ctx: GraphQLContext,
    ) => {
      // Public query — no requireAuth
      const roadmap = await ctx.prisma.publicRoadmap.findUnique({
        where: { slug },
      });

      if (!roadmap?.enabled) {
        throw new GraphQLError('Roadmap not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const requiresPassword = !!roadmap.passwordHash && !password;

      if (roadmap.passwordHash && password) {
        const valid = await ctx.services.roadmap.verifyPassword(
          roadmap,
          password,
        );
        if (!valid) {
          throw new GraphQLError('Invalid password', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
      }

      if (requiresPassword) {
        return {
          projects: [],
          requiresPassword: true,
          roadmap: { ...roadmap, hasPassword: true },
        };
      }

      try {
        // Password already verified above; omit it to skip the redundant scrypt in getRoadmapProjects
        const projects = await ctx.services.roadmap.getRoadmapProjects(
          roadmap.organizationId,
        );
        return {
          projects,
          requiresPassword: false,
          roadmap: { ...roadmap, hasPassword: !!roadmap.passwordHash },
        };
      } catch (err) {
        if (
          err instanceof RoadmapNotFoundError ||
          err instanceof RoadmapPasswordError
        ) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        throw err;
      }
    },
  },
};
