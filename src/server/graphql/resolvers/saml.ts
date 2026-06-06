import { requireAuth, requireOrgRole } from '../../middleware/auth';
import type { SamlConfigInput } from '../../services/saml.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const SAML_ERROR_MAP = {
  BAD_USER_INPUT: ['SamlParseError', 'SamlNotConfiguredError', 'SamlNotEnabledError'],
} as const;

async function requireSamlAdmin(
  ctx: GraphQLContext,
): Promise<GraphQLContext & { orgId: string; userId: string }> {
  requireAuth(ctx);
  await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
  return ctx as GraphQLContext & { orgId: string; userId: string };
}

export const samlResolvers = {
  Mutation: {
    samlConfigurationDelete: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const auth = await requireSamlAdmin(ctx);
      try {
        await ctx.services.saml.deleteConfig(auth.orgId);
        void ctx.services.auditLog.log({
          action: 'saml.disabled',
          orgId: auth.orgId,
          userId: auth.userId,
        });
        return { success: true };
      } catch (err) {
        mapServiceError(err, SAML_ERROR_MAP);
      }
    },

    samlConfigurationSave: async (
      _parent: unknown,
      { input }: { input: SamlConfigInput },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireSamlAdmin(ctx);
      try {
        const configuration = await ctx.services.saml.saveConfig(auth.orgId, auth.userId, input);
        void ctx.services.auditLog.log({
          action: input.enabled ? 'saml.enabled' : 'saml.configured',
          metadata: { idpEntityId: input.idpEntityId, ssoEnforced: input.ssoEnforced },
          orgId: auth.orgId,
          userId: auth.userId,
        });
        return { configuration, success: true };
      } catch (err) {
        mapServiceError(err, SAML_ERROR_MAP);
      }
    },
  },

  Query: {
    samlConfiguration: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const auth = await requireSamlAdmin(ctx);
      return ctx.services.saml.getConfig(auth.orgId);
    },
  },
};
