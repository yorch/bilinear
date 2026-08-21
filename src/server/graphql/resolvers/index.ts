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
import { platformAdminResolvers } from './platform-admin';
import { projectResolvers } from './project';
import { roadmapResolvers } from './roadmap';
import { samlResolvers } from './saml';
import { scimResolvers } from './scim';
import { searchResolvers } from './search';
import { settingResolvers } from './setting';
import { slackResolvers } from './slack';
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

/** Shared by the `ApiToken`/`ScimToken` projections — see the note on their map entries. */
const labelOrEmpty = (token: { label: string | null }) => token.label ?? '';

export const resolvers = {
  // `ApiToken`/`ScimToken` are projections over `auth_tokens`, whose `label`
  // column is nullable because the table is shared with magic-link and refresh
  // tokens that legitimately have none — so it can't be tightened at the DB
  // level. Both SDL fields are `String!`, and a null there nulls the whole
  // `apiTokens`/`scimTokens` list (both are `[T!]!`) rather than one field.
  // Every creation path requires a non-blank label; this only catches a legacy
  // or hand-inserted row.
  ApiToken: {
    label: labelOrEmpty,
  },
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
    ...settingResolvers.Mutation,
    ...authResolvers.Mutation,
    ...automationResolvers.Mutation,
    ...commentResolvers.Mutation,
    ...userResolvers.Mutation,
    ...documentResolvers.Mutation,
    ...favoriteResolvers.Mutation,
    ...fileResolvers.Mutation,
    ...githubResolvers.Mutation,
    ...importResolvers.Mutation,
    ...slackResolvers.Mutation,
    ...initiativeResolvers.Mutation,
    ...notificationResolvers.Mutation,
    ...issueRelationResolvers.Mutation,
    ...issueTemplateResolvers.Mutation,
    ...organizationResolvers.Mutation,
    ...platformAdminResolvers.Mutation,
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

  Organization: {
    ...organizationResolvers.Organization,
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
    ...slackResolvers.Query,
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
    ...platformAdminResolvers.Query,
    ...customFieldResolvers.Query,
    ...customViewResolvers.Query,
    ...teamResolvers.Query,
    ...issueResolvers.Query,
    ...labelResolvers.Query,
    ...searchResolvers.Query,
    ...settingResolvers.Query,
    ...cycleResolvers.Query,
    ...projectResolvers.Query,
    ...roadmapResolvers.Query,
    ...samlResolvers.Query,
    ...scimResolvers.Query,
    ...triageResolvers.Query,
    ...webhookResolvers.Query,
  },

  ScimToken: {
    label: labelOrEmpty,
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
