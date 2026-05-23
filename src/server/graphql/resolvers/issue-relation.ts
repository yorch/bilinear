import { GraphQLError } from 'graphql';
import type { IssueRelation } from '../../../generated/prisma';
import {
  requireAuth,
  requireIssueAccessNotGuestOrOwn,
  requireTeamMember,
} from '../../middleware/auth';
import type { IssueRelationCreateInput } from '../../services/issue-relation.service';
import type { GraphQLContext } from '../context';

export const issueRelationResolvers = {
  IssueRelation: {
    issue: async (relation: IssueRelation, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.issue.findById(relation.issueId),
    relatedIssue: async (relation: IssueRelation, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.issue.findById(relation.relatedIssueId),
  },
  Mutation: {
    issueRelationCreate: async (
      _parent: unknown,
      { input }: { input: IssueRelationCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const issue = await ctx.services.issue.findById(input.issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);
      const relatedIssue = await ctx.services.issue.findById(input.relatedIssueId);
      if (!relatedIssue || relatedIssue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Related issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, relatedIssue.teamId, ctx.userId, ctx.orgId);
      try {
        const { relation, canceledIssue } = await ctx.services.issueRelation.create(input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'IssueRelation',
          relation.id,
          relation,
        );
        // Duplicate auto-cancel: emit a SyncAction + activity record for the
        // issue that was transitioned, so all clients see the state change.
        if (canceledIssue) {
          await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'U',
            'Issue',
            canceledIssue.id,
            canceledIssue,
          );
          void ctx.services.issueActivity
            .create({
              actorId: ctx.userId,
              field: 'stateId',
              issueId: canceledIssue.id,
              newValue: canceledIssue.stateId,
              oldValue: issue.stateId,
            })
            .catch(() => {});
        }
        return {
          issueRelation: relation,
          lastSyncId: sync.id.toString(),
          success: true,
        };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'IssueRelationAlreadyExistsError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        if (error.name === 'IssueRelationCircularError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },
    issueRelationDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const relation = await ctx.services.issueRelation.findById(id);
      if (!relation) {
        throw new GraphQLError('Issue relation not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const issue = await ctx.services.issue.findById(relation.issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue relation not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);
      await ctx.services.issueRelation.delete(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'IssueRelation',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },
  },
  Query: {
    issueRelations: async (
      _parent: unknown,
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
      return ctx.services.issueRelation.findByIssueId(issueId);
    },
  },
};
