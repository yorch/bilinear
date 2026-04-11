import { DateTimeScalar, JSONScalar, UUIDScalar } from '../types/scalars';
import { authResolvers } from './auth';
import { commentResolvers } from './comment';
import { customViewResolvers } from './custom-view';
import { cycleResolvers } from './cycle';
import { issueResolvers } from './issue';
import { issueActivityResolvers } from './issue-activity';
import { issueRelationResolvers } from './issue-relation';
import { issueTemplateResolvers } from './issue-template';
import { labelResolvers } from './label';
import { notificationResolvers } from './notification';
import { organizationResolvers } from './organization';
import { projectResolvers } from './project';
import { searchResolvers } from './search';
import { teamResolvers } from './team';
import { teamMembershipResolvers } from './team-membership';
import { userResolvers } from './user';
import { workflowStateResolvers } from './workflow-state';

// Scalar for date-only strings (YYYY-MM-DD). Validates format on input.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerceDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(
      `Date must be a YYYY-MM-DD string, got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

const DateScalar = {
  parseLiteral: (ast: { kind: string; value?: string }) => {
    if (ast.kind !== 'StringValue' || !ast.value) {
      throw new Error('Date literal must be a string');
    }
    return coerceDate(ast.value);
  },
  parseValue: coerceDate,
  serialize: (value: unknown) => {
    // Dates stored as Date objects in Postgres — serialize to YYYY-MM-DD
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    return coerceDate(value);
  },
};

export const resolvers = {
  AuthPayload: {
    ...authResolvers.AuthPayload,
  },

  Comment: {
    ...commentResolvers.Comment,
  },

  CommentReaction: {
    ...commentResolvers.CommentReaction,
  },

  CustomView: {
    ...customViewResolvers.CustomView,
  },

  Cycle: {
    ...cycleResolvers.Cycle,
  },

  Date: DateScalar,

  DateTime: DateTimeScalar,

  Issue: {
    ...issueResolvers.Issue,
  },

  IssueActivity: {
    ...issueActivityResolvers.IssueActivity,
  },

  IssueLabel: {
    ...labelResolvers.IssueLabel,
  },

  IssueRelation: {
    ...issueRelationResolvers.IssueRelation,
  },

  IssueTemplate: {
    ...issueTemplateResolvers.IssueTemplate,
  },

  JSON: JSONScalar,

  Mutation: {
    ...authResolvers.Mutation,
    ...commentResolvers.Mutation,
    ...notificationResolvers.Mutation,
    ...issueRelationResolvers.Mutation,
    ...issueTemplateResolvers.Mutation,
    ...organizationResolvers.Mutation,
    ...customViewResolvers.Mutation,
    ...cycleResolvers.Mutation,
    ...issueResolvers.Mutation,
    ...labelResolvers.Mutation,
    ...projectResolvers.Mutation,
    ...teamResolvers.Mutation,
    ...teamMembershipResolvers.Mutation,
    ...workflowStateResolvers.Mutation,
  },

  Notification: {
    ...notificationResolvers.Notification,
  },

  Project: {
    ...projectResolvers.Project,
  },

  ProjectMilestone: {
    ...projectResolvers.ProjectMilestone,
  },

  ProjectUpdate: {
    ...projectResolvers.ProjectUpdate,
  },

  Query: {
    ...userResolvers.Query,
    ...commentResolvers.Query,
    ...issueActivityResolvers.Query,
    ...notificationResolvers.Query,
    ...issueRelationResolvers.Query,
    ...issueTemplateResolvers.Query,
    ...organizationResolvers.Query,
    ...customViewResolvers.Query,
    ...teamResolvers.Query,
    ...issueResolvers.Query,
    ...labelResolvers.Query,
    ...searchResolvers.Query,
    ...cycleResolvers.Query,
    ...projectResolvers.Query,
  },

  Team: {
    ...teamResolvers.Team,
  },

  TeamMembership: {
    ...teamResolvers.TeamMembership,
  },

  User: {
    ...userResolvers.User,
  },

  UUID: UUIDScalar,

  WorkflowState: {
    ...workflowStateResolvers.WorkflowState,
  },
};
