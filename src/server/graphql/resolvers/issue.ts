import { GraphQLError } from 'graphql';
import type { Issue } from '../../../generated/prisma';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type {
  IssueCreateInput,
  IssueFilter,
  IssueUpdateInput,
} from '../../services/issue.service';
import type { GraphQLContext } from '../context';

export const issueResolvers = {
  Issue: {
    assignee: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.assigneeId) {
        return null;
      }
      return ctx.services.user.findById(issue.assigneeId);
    },

    children: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      return ctx.prisma.issue.findMany({
        orderBy: { subIssueSortOrder: 'asc' },
        where: { parentId: issue.id, trashed: false },
      });
    },

    creator: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.creatorId) {
        return null;
      }
      return ctx.services.user.findById(issue.creatorId);
    },

    dueDate: (issue: Issue) => {
      return issue.dueDate ? issue.dueDate.toISOString().split('T')[0] : null;
    },

    labels: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.issue.getLabels(issue.id);
    },

    parent: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.parentId) {
        return null;
      }
      return ctx.services.issue.findById(issue.parentId);
    },

    state: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.workflowState.findById(issue.stateId);
    },
    team: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.team.findById(issue.teamId);
    },
  },
  Mutation: {
    issueArchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      const issue = await ctx.services.issue.archive(id);
      return { issue, lastSyncId: 0, success: true };
    },
    issueCreate: async (
      _parent: unknown,
      { input }: { input: IssueCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, input.teamId, ctx.userId);

      try {
        const issue = await ctx.services.issue.create(
          ctx.orgId,
          ctx.userId,
          input,
        );
        return { issue, lastSyncId: 0, success: true };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'IssueStateRequiredError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    issueDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      await ctx.services.issue.delete(id);
      return { lastSyncId: 0, success: true };
    },

    issueUnarchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      const issue = await ctx.services.issue.unarchive(id);
      return { issue, lastSyncId: 0, success: true };
    },

    issueUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: IssueUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      const issue = await ctx.services.issue.update(id, input);
      return { issue, lastSyncId: 0, success: true };
    },
  },

  Query: {
    issue: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(id);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);
      return issue;
    },

    issues: async (
      _parent: unknown,
      args: {
        filter?: IssueFilter;
        first?: number;
        after?: string;
        last?: number;
        before?: string;
        includeArchived?: boolean;
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const {
        filter = {},
        first,
        after,
        last,
        before,
        includeArchived = false,
      } = args;

      // Enforce team membership — callers must scope queries to a specific
      // team they belong to. Org-wide issue enumeration is not permitted.
      if (!filter.teamId) {
        throw new GraphQLError(
          'filter.teamId is required — queries must be scoped to a specific team',
          { extensions: { code: 'BAD_USER_INPUT' } },
        );
      }
      await requireTeamMember(ctx.prisma, filter.teamId, ctx.userId);

      const page = await ctx.services.issue.findMany(
        ctx.orgId,
        filter,
        { after, before, first, last },
        includeArchived,
      );

      const edges = page.nodes.map(node => ({
        cursor: node.id,
        node,
      }));

      return {
        edges,
        nodes: page.nodes,
        pageInfo: page.pageInfo,
        totalCount: page.totalCount,
      };
    },
  },
};
