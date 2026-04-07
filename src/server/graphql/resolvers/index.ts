import { DateTimeScalar, UUIDScalar } from '../types/scalars';
import { authResolvers } from './auth';
import { issueResolvers } from './issue';
import { labelResolvers } from './label';
import { organizationResolvers } from './organization';
import { teamResolvers } from './team';
import { teamMembershipResolvers } from './team-membership';
import { userResolvers } from './user';
import { workflowStateResolvers } from './workflow-state';

// Passthrough scalar for date strings (YYYY-MM-DD)
const DateScalar = {
  parseLiteral: (ast: { value: string }) => ast.value,
  parseValue: (value: unknown) => value,
  serialize: (value: unknown) => value,
};

export const resolvers = {
  AuthPayload: {
    ...authResolvers.AuthPayload,
  },

  Date: DateScalar,

  DateTime: DateTimeScalar,

  Issue: {
    ...issueResolvers.Issue,
  },

  IssueLabel: {
    ...labelResolvers.IssueLabel,
  },

  Mutation: {
    ...authResolvers.Mutation,
    ...issueResolvers.Mutation,
    ...labelResolvers.Mutation,
    ...teamResolvers.Mutation,
    ...teamMembershipResolvers.Mutation,
    ...workflowStateResolvers.Mutation,
  },

  Query: {
    ...userResolvers.Query,
    ...organizationResolvers.Query,
    ...teamResolvers.Query,
    ...issueResolvers.Query,
    ...labelResolvers.Query,
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
