import { GraphQLError } from 'graphql';
import type { CustomFieldDefinition, CustomFieldValue } from '../../../generated/prisma';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
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
  if (!existing) {
    throw new GraphQLError('Custom field not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  const team = await ctx.services.team.findById(existing.teamId);
  if (!team || team.organizationId !== ctx.orgId) {
    throw new GraphQLError('Custom field not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);
  return existing;
}

export const customFieldResolvers = {
  CustomFieldDefinition: {
    team: async (def: CustomFieldDefinition, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.team.findById(def.teamId),
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
      { input }: { input: CustomFieldDefinitionCreateInput },
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
      try {
        const def = await ctx.services.customField.createDefinition(input);
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
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);
      try {
        await ctx.services.customField.setValuesForIssue(issueId, values);
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
      await requireTeamMember(ctx.prisma, teamId, ctx.userId);
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
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);
      return ctx.services.customField.findValuesByIssueIds([issueId]);
    },
  },
};
