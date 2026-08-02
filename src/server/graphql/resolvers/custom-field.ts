import { GraphQLError } from 'graphql';
import type { CustomFieldDefinition, CustomFieldValue } from '../../../generated/prisma';
import { requireAuth, requireOrgRole, requireTeamMember } from '../../middleware/auth';
import {
  type CustomFieldDefinitionCreateInput,
  CustomFieldDefinitionNotFoundError,
  type CustomFieldDefinitionUpdateInput,
  CustomFieldInvalidOptionsError,
  CustomFieldInvalidValueError,
  CustomFieldLimitExceededError,
  type CustomFieldValueInput,
} from '../../services/custom-field.service';
import type { GraphQLContext } from '../context';

/** GraphQL input — `teamId` may be null for workspace-scoped definitions. */
interface CustomFieldDefinitionCreateGqlInput {
  description?: string;
  name: string;
  options?: Array<{ color?: string; label: string; value: string }>;
  required?: boolean;
  sortOrder?: number;
  teamId: string | null;
  type: CustomFieldDefinitionCreateInput['type'];
}

function mapServiceError(err: unknown): GraphQLError {
  if (err instanceof CustomFieldDefinitionNotFoundError) {
    return new GraphQLError(err.message, {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  if (
    err instanceof CustomFieldInvalidOptionsError ||
    err instanceof CustomFieldInvalidValueError ||
    err instanceof CustomFieldLimitExceededError
  ) {
    return new GraphQLError(err.message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  throw err;
}

async function loadDefinitionForMutation(
  id: string,
  ctx: GraphQLContext,
): Promise<CustomFieldDefinition> {
  requireAuth(ctx);
  const existing = await ctx.services.customField.findDefinitionById(id);
  if (!existing || existing.organizationId !== ctx.orgId) {
    throw new GraphQLError('Custom field not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  if (existing.teamId === null) {
    // Workspace-scoped: only owners/admins can manage.
    requireOrgRole(ctx, ['owner', 'admin']);
  } else {
    await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);
  }
  return existing;
}

export const customFieldResolvers = {
  CustomFieldDefinition: {
    team: async (def: CustomFieldDefinition, _args: unknown, ctx: GraphQLContext) =>
      def.teamId ? ctx.services.team.findById(def.teamId) : null,
  },
  CustomFieldValue: {
    definition: async (value: CustomFieldValue, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.customField.findDefinitionById(value.definitionId),
  },
  Issue: {
    customFieldValues: async (issue: { id: string }, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.customField.findValuesByIssueIds([issue.id]),
  },
  Mutation: {
    customFieldDefinitionArchive: async (
      _p: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await loadDefinitionForMutation(id, ctx);
      try {
        const def = await ctx.services.customField.archiveDefinition(id);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'A',
          'CustomFieldDefinition',
          id,
          def,
        );
        return {
          customFieldDefinition: def,
          lastSyncId: sync.id.toString(),
          success: true,
        };
      } catch (err) {
        throw mapServiceError(err);
      }
    },
    customFieldDefinitionCreate: async (
      _p: unknown,
      { input }: { input: CustomFieldDefinitionCreateGqlInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      // teamId is `String` (nullable) in the SDL: clients can pass null
      // (workspace-scope) or a UUID. Omitting the key entirely arrives
      // as undefined — surface that as BAD_USER_INPUT instead of letting
      // undefined fall through into requireTeamMember and crash with an
      // internal error.
      if (input.teamId === undefined) {
        throw new GraphQLError('teamId is required; pass null for a workspace-scoped definition', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (typeof input.teamId === 'string' && input.teamId.length === 0) {
        throw new GraphQLError('teamId must be null or a non-empty UUID', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (input.teamId === null) {
        // Workspace-scoped: owner/admin only — these fields show on every team.
        requireOrgRole(ctx, ['owner', 'admin']);
      } else {
        await requireTeamMember(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);
        const team = await ctx.services.team.findById(input.teamId);
        if (!team || team.organizationId !== ctx.orgId) {
          throw new GraphQLError('Team not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }
      }
      try {
        const def = await ctx.services.customField.createDefinition({
          ...input,
          organizationId: ctx.orgId,
        });
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'CustomFieldDefinition',
          def.id,
          def,
        );
        return {
          customFieldDefinition: def,
          lastSyncId: sync.id.toString(),
          success: true,
        };
      } catch (err) {
        throw mapServiceError(err);
      }
    },
    customFieldDefinitionDelete: async (
      _p: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await loadDefinitionForMutation(id, ctx);
      try {
        await ctx.services.customField.deleteDefinition(id);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'D',
          'CustomFieldDefinition',
          id,
          null,
        );
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        throw mapServiceError(err);
      }
    },
    customFieldDefinitionUpdate: async (
      _p: unknown,
      { id, input }: { id: string; input: CustomFieldDefinitionUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await loadDefinitionForMutation(id, ctx);
      try {
        const def = await ctx.services.customField.updateDefinition(id, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'CustomFieldDefinition',
          id,
          def,
        );
        return {
          customFieldDefinition: def,
          lastSyncId: sync.id.toString(),
          success: true,
        };
      } catch (err) {
        throw mapServiceError(err);
      }
    },
    customFieldValuesSet: async (
      _p: unknown,
      { issueId, values }: { issueId: string; values: CustomFieldValueInput[] },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);
      try {
        await ctx.services.customField.setValuesForIssue(
          { id: issue.id, organizationId: issue.organizationId, teamId: issue.teamId },
          values,
        );
      } catch (err) {
        throw mapServiceError(err);
      }
      const allValues = await ctx.services.customField.findValuesByIssueIds([issueId]);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Issue', issueId, {
        customFieldValues: allValues,
      });
      return {
        lastSyncId: sync.id.toString(),
        success: true,
        values: allValues,
      };
    },
  },
  Query: {
    customFieldDefinition: async (_p: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return loadDefinitionForMutation(id, ctx);
    },
    customFieldDefinitions: async (
      _p: unknown,
      { teamId, includeArchived }: { teamId: string; includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
      return ctx.services.customField.findDefinitionsByTeamId(teamId, includeArchived ?? false);
    },
    customFieldValuesForIssue: async (
      _p: unknown,
      { issueId }: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);
      return ctx.services.customField.findValuesByIssueIds([issueId]);
    },
    workspaceCustomFieldDefinitions: async (
      _p: unknown,
      { includeArchived }: { includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.customField.findWorkspaceDefinitions(ctx.orgId, includeArchived ?? false);
    },
  },
};
