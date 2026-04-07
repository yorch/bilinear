import { GraphQLError } from 'graphql';
import type { IssueLabel } from '../../../generated/prisma';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type {
  LabelCreateInput,
  LabelUpdateInput,
} from '../../services/label.service';
import type { GraphQLContext } from '../context';

export const labelResolvers = {
  IssueLabel: {
    children: async (
      label: IssueLabel,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      return ctx.prisma.issueLabel.findMany({
        orderBy: { name: 'asc' },
        where: { archivedAt: null, parentId: label.id },
      });
    },
    parent: async (label: IssueLabel, _args: unknown, ctx: GraphQLContext) => {
      if (!label.parentId) {
        return null;
      }
      return ctx.services.label.findById(label.parentId);
    },
  },
  Mutation: {
    issueLabelArchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.label.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Label not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      // Team-scoped labels require team membership
      if (existing.teamId) {
        await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);
      }

      const label = await ctx.services.label.archive(id);
      return { issueLabel: label, lastSyncId: 0, success: true };
    },
    issueLabelCreate: async (
      _parent: unknown,
      { input }: { input: LabelCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      // Team-scoped labels require team membership
      if (input.teamId) {
        await requireTeamMember(ctx.prisma, input.teamId, ctx.userId);
      }

      const label = await ctx.services.label.create(
        ctx.orgId,
        ctx.userId,
        input,
      );
      return { issueLabel: label, lastSyncId: 0, success: true };
    },

    issueLabelUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: LabelUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.label.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Label not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      // Team-scoped labels require team membership
      if (existing.teamId) {
        await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);
      }

      const label = await ctx.services.label.update(id, input);
      return { issueLabel: label, lastSyncId: 0, success: true };
    },
  },

  Query: {
    labels: async (
      _parent: unknown,
      args: { teamId?: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const labels = await ctx.services.label.findByOrgId(
        ctx.orgId,
        args.teamId,
      );
      const edges = labels.map(node => ({ cursor: node.id, node }));

      return {
        edges,
        nodes: labels,
        pageInfo: {
          endCursor: edges[edges.length - 1]?.cursor ?? null,
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: edges[0]?.cursor ?? null,
        },
        totalCount: labels.length,
      };
    },
  },
};
