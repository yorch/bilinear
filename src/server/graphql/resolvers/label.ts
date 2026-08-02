import { GraphQLError } from 'graphql';
import type { IssueLabel } from '../../../generated/prisma';
import { requireAuth, requireOrgRole, requireTeamMember } from '../../middleware/auth';
import type { LabelCreateInput, LabelUpdateInput } from '../../services/label.service';
import type { GraphQLContext } from '../context';

function handleLabelError(err: unknown): never {
  const error = err as Error;
  if (error.name === 'LabelGroupDepthError' || error.name === 'LabelGroupCapacityError') {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  if (error.name === 'LabelParentNotFoundError' || error.name === 'LabelNotFoundError') {
    throw new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND' } });
  }
  throw err;
}

/**
 * Authorize a label write. Team-scoped labels require team membership;
 * workspace-scoped labels (no teamId) apply org-wide, so — like workspace
 * custom fields — they are owner/admin-only.
 */
async function requireLabelWriteAccess(
  ctx: GraphQLContext & { userId: string; orgId: string },
  teamId: string | null | undefined,
): Promise<void> {
  if (teamId) {
    await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
  } else {
    requireOrgRole(ctx, ['owner', 'admin']);
  }
}

export const labelResolvers = {
  IssueLabel: {
    children: async (label: IssueLabel, _args: unknown, ctx: GraphQLContext) =>
      ctx.prisma.issueLabel.findMany({
        orderBy: { name: 'asc' },
        where: { archivedAt: null, parentId: label.id },
      }),
    parent: async (label: IssueLabel, _args: unknown, ctx: GraphQLContext) => {
      if (!label.parentId) {
        return null;
      }
      return ctx.services.label.findById(label.parentId);
    },
  },
  Mutation: {
    issueLabelArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.label.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Label not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireLabelWriteAccess(ctx, existing.teamId);

      const label = await ctx.services.label.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'IssueLabel',
        id,
        label,
      );
      return {
        issueLabel: label,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },
    issueLabelCreate: async (
      _parent: unknown,
      { input }: { input: LabelCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      await requireLabelWriteAccess(ctx, input.teamId);

      let label: IssueLabel;
      try {
        label = await ctx.services.label.create(ctx.orgId, ctx.userId, input);
      } catch (err) {
        handleLabelError(err);
      }
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'IssueLabel',
        label.id,
        label,
      );
      return {
        issueLabel: label,
        lastSyncId: sync.id.toString(),
        success: true,
      };
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
      await requireLabelWriteAccess(ctx, existing.teamId);

      let label: IssueLabel;
      try {
        label = await ctx.services.label.update(id, input);
      } catch (err) {
        handleLabelError(err);
      }
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'IssueLabel',
        id,
        label,
      );
      return {
        issueLabel: label,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },
  },

  Query: {
    labels: async (_parent: unknown, args: { teamId?: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const labels = await ctx.services.label.findByOrgId(ctx.orgId, args.teamId);
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
