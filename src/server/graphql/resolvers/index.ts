import { DateTimeScalar, UUIDScalar } from '../types/scalars';
import { authResolvers } from './auth';
import { organizationResolvers } from './organization';
import { teamResolvers } from './team';
import { teamMembershipResolvers } from './team-membership';
import { userResolvers } from './user';
import { workflowStateResolvers } from './workflow-state';

export const resolvers = {
  AuthPayload: {
    ...authResolvers.AuthPayload,
  },

  DateTime: DateTimeScalar,

  Mutation: {
    ...authResolvers.Mutation,
    ...teamResolvers.Mutation,
    ...teamMembershipResolvers.Mutation,
    ...workflowStateResolvers.Mutation,
  },

  Query: {
    ...userResolvers.Query,
    ...organizationResolvers.Query,
    ...teamResolvers.Query,
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
