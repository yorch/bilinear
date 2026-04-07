import { DateTimeScalar, UUIDScalar } from '../types/scalars';
import { authResolvers } from './auth';
import { issueResolvers } from './issue';
import { labelResolvers } from './label';
import { organizationResolvers } from './organization';
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
    ...searchResolvers.Query,
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
