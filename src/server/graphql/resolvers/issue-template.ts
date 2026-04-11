import { GraphQLError } from 'graphql';
import type { IssueTemplate } from '../../../generated/prisma';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type {
  IssueTemplateCreateInput,
  IssueTemplateUpdateInput,
} from '../../services/issue-template.service';
import type { GraphQLContext } from '../context';

export const issueTemplateResolvers = {
  IssueTemplate: {
    creator: async (
      template: IssueTemplate,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      if (!template.creatorId) {
        return null;
      }
      return ctx.services.user.findById(template.creatorId);
    },
    team: async (
      template: IssueTemplate,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      return ctx.services.team.findById(template.teamId);
    },
  },
  Mutation: {
    issueTemplateArchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const existing = await ctx.services.issueTemplate.findById(id);
      if (!existing) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const team = await ctx.services.team.findById(existing.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);
      const template = await ctx.services.issueTemplate.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'IssueTemplate',
        id,
        template,
      );
      return {
        issueTemplate: template,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },
    issueTemplateCreate: async (
      _parent: unknown,
      { input }: { input: IssueTemplateCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, input.teamId, ctx.userId);
      const team = await ctx.services.team.findById(input.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const template = await ctx.services.issueTemplate.create(
        input,
        ctx.userId,
      );
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'IssueTemplate',
        template.id,
        template,
      );
      return {
        issueTemplate: template,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },
    issueTemplateDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const existing = await ctx.services.issueTemplate.findById(id);
      if (!existing) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const team = await ctx.services.team.findById(existing.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);
      await ctx.services.issueTemplate.delete(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'IssueTemplate',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },
    issueTemplateUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: IssueTemplateUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const existing = await ctx.services.issueTemplate.findById(id);
      if (!existing) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const team = await ctx.services.team.findById(existing.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);
      const template = await ctx.services.issueTemplate.update(id, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'IssueTemplate',
        id,
        template,
      );
      return {
        issueTemplate: template,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },
  },
  Query: {
    issueTemplate: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const template = await ctx.services.issueTemplate.findById(id);
      if (!template) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const team = await ctx.services.team.findById(template.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Template not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return template;
    },
    issueTemplates: async (
      _parent: unknown,
      {
        teamId,
        includeArchived,
      }: { teamId: string; includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, teamId, ctx.userId);
      return ctx.services.issueTemplate.findByTeamId(
        teamId,
        includeArchived ?? false,
      );
    },
  },
};
