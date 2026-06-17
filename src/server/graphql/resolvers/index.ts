import { DateTimeScalar, JSONScalar, UUIDScalar } from '../types/scalars';
import { aiResolvers } from './ai';
import { analyticsResolvers } from './analytics';
import { auditLogResolvers } from './audit-log';
import { authResolvers } from './auth';
import { automationResolvers } from './automation';
import { commentResolvers } from './comment';
import { customFieldResolvers } from './custom-field';
import { customViewResolvers } from './custom-view';
import { cycleResolvers } from './cycle';
import { documentResolvers } from './document';
import { favoriteResolvers } from './favorite';
import { fileResolvers } from './file';
import { githubResolvers } from './github';
import { importResolvers } from './import';
import { initiativeResolvers } from './initiative';
import { issueResolvers } from './issue';
import { issueActivityResolvers } from './issue-activity';
import { issueRelationResolvers } from './issue-relation';
import { issueTemplateResolvers } from './issue-template';
import { labelResolvers } from './label';
import { notificationResolvers } from './notification';
import { organizationResolvers } from './organization';
import { projectResolvers } from './project';
import { roadmapResolvers } from './roadmap';
import { samlResolvers } from './saml';
import { scimResolvers } from './scim';
import { searchResolvers } from './search';
import { teamResolvers } from './team';
import { teamMembershipResolvers } from './team-membership';
import { triageResolvers } from './triage';
import { userResolvers } from './user';
import { webhookResolvers } from './webhook';
import { workflowStateResolvers } from './workflow-state';

// Scalar for date-only strings (YYYY-MM-DD). Validates format on input.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerceDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(`Date must be a YYYY-MM-DD string, got: ${JSON.stringify(value)}`);
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
  AuditLogEntry: {
    ...auditLogResolvers.AuditLogEntry,
  },

  AuthPayload: {
    ...authResolvers.AuthPayload,
  },

  Comment: {
    ...commentResolvers.Comment,
  },

  CommentReaction: {
    ...commentResolvers.CommentReaction,
  },

  CustomFieldDefinition: {
    ...customFieldResolvers.CustomFieldDefinition,
  },

  CustomFieldValue: {
    ...customFieldResolvers.CustomFieldValue,
  },

  CustomView: {
    ...customViewResolvers.CustomView,
  },

  Cycle: {
    ...cycleResolvers.Cycle,
  },

  Date: DateScalar,

  DateTime: DateTimeScalar,

  Favorite: {
    ...favoriteResolvers.Favorite,
  },

  Initiative: {
    ...initiativeResolvers.Initiative,
  },

  InitiativeUpdate: {
    ...initiativeResolvers.InitiativeUpdate,
  },

  Issue: {
    ...issueResolvers.Issue,
    ...customFieldResolvers.Issue,
    ...fileResolvers.Issue,
    ...githubResolvers.Issue,
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
    ...aiResolvers.Mutation,
    ...authResolvers.Mutation,
    ...automationResolvers.Mutation,
    ...commentResolvers.Mutation,
    ...userResolvers.Mutation,
    ...documentResolvers.Mutation,
    ...favoriteResolvers.Mutation,
    ...fileResolvers.Mutation,
    ...githubResolvers.Mutation,
    ...importResolvers.Mutation,
    ...initiativeResolvers.Mutation,
    ...notificationResolvers.Mutation,
    ...issueRelationResolvers.Mutation,
    ...issueTemplateResolvers.Mutation,
    ...organizationResolvers.Mutation,
    ...customFieldResolvers.Mutation,
    ...customViewResolvers.Mutation,
    ...cycleResolvers.Mutation,
    ...issueResolvers.Mutation,
    ...labelResolvers.Mutation,
    ...projectResolvers.Mutation,
    ...roadmapResolvers.Mutation,
    ...teamResolvers.Mutation,
    ...teamMembershipResolvers.Mutation,
    ...samlResolvers.Mutation,
    ...scimResolvers.Mutation,
    ...triageResolvers.Mutation,
    ...webhookResolvers.Mutation,
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
    ...aiResolvers.Query,
    ...analyticsResolvers.Query,
    ...importResolvers.Query,
    ...auditLogResolvers.Query,
    ...authResolvers.Query,
    ...automationResolvers.Query,
    ...userResolvers.Query,
    ...commentResolvers.Query,
    ...documentResolvers.Query,
    ...favoriteResolvers.Query,
    ...fileResolvers.Query,
    ...githubResolvers.Query,
    ...initiativeResolvers.Query,
    ...issueActivityResolvers.Query,
    ...notificationResolvers.Query,
    ...issueRelationResolvers.Query,
    ...issueTemplateResolvers.Query,
    ...organizationResolvers.Query,
    ...customFieldResolvers.Query,
    ...customViewResolvers.Query,
    ...teamResolvers.Query,
    ...issueResolvers.Query,
    ...labelResolvers.Query,
    ...searchResolvers.Query,
    ...cycleResolvers.Query,
    ...projectResolvers.Query,
    ...roadmapResolvers.Query,
    ...samlResolvers.Query,
    ...scimResolvers.Query,
    ...triageResolvers.Query,
    ...webhookResolvers.Query,
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

  Webhook: {
    ...webhookResolvers.Webhook,
  },

  WorkflowState: {
    ...workflowStateResolvers.WorkflowState,
  },
};
