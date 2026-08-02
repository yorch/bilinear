import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const SCIM_ERROR_MAP = {
  NOT_FOUND: ['ScimTokenNotFoundError'],
} as const;

async function requireOrgAdmin(
  ctx: GraphQLContext,
): Promise<GraphQLContext & { orgId: string; userId: string }> {
  requireAuth(ctx);
  requireOrgRole(ctx, ['owner', 'admin']);
  return ctx as GraphQLContext & { orgId: string; userId: string };
}

export const scimResolvers = {
  Mutation: {
    scimTokenCreate: async (
      _parent: unknown,
      { label }: { label: string },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireOrgAdmin(ctx);
      if (!label.trim()) {
        throw new GraphQLError('Label is required', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      try {
        const result = await ctx.services.scim.createToken(auth.orgId, auth.userId, label.trim());
        const token = await ctx.prisma.scimToken.findUnique({
          select: { createdAt: true, id: true, label: true, lastUsedAt: true },
          where: { id: result.id },
        });
        void ctx.services.auditLog.log({
          action: 'scim.token_created',
          metadata: { label: label.trim(), tokenId: result.id },
          orgId: auth.orgId,
          userId: auth.userId,
        });
        return { plaintext: result.plaintext, success: true, token };
      } catch (err) {
        mapServiceError(err, SCIM_ERROR_MAP);
      }
    },

    scimTokenRevoke: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        await ctx.services.scim.revokeToken(id, auth.orgId);
        void ctx.services.auditLog.log({
          action: 'scim.token_revoked',
          metadata: { tokenId: id },
          orgId: auth.orgId,
          userId: auth.userId,
        });
        return { success: true };
      } catch (err) {
        mapServiceError(err, SCIM_ERROR_MAP);
      }
    },
  },

  Query: {
    scimTokens: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      return ctx.services.scim.listTokens(auth.orgId);
    },
  },
};
