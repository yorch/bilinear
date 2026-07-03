import { createLoaders, type Loaders } from '../server/graphql/loaders';
import { AnalyticsService } from '../server/services/analytics.service';
import { AuditLogService } from '../server/services/audit-log.service';
import { AuthService } from '../server/services/auth.service';
import { AutomationService } from '../server/services/automation.service';
import { InitiativeService } from '../server/services/initiative.service';
import { IssueService } from '../server/services/issue.service';
import { IssueActivityService } from '../server/services/issue-activity.service';
import { LabelService } from '../server/services/label.service';
import { NotificationService } from '../server/services/notification.service';
import { OrganizationService } from '../server/services/organization.service';
import { PlatformAdminService } from '../server/services/platform-admin.service';
import { SamlService } from '../server/services/saml.service';
import { ScimService } from '../server/services/scim.service';
import { SearchService } from '../server/services/search.service';
import type { SyncActionType } from '../server/services/sync.service';
import { TeamService } from '../server/services/team.service';
import { TriageService } from '../server/services/triage.service';
import { UserService } from '../server/services/user.service';
import { WorkflowStateService } from '../server/services/workflow-state.service';
import { TEST_ORG, TEST_USER } from './fixtures';
import { createMockPrisma, type MockPrismaClient } from './prisma-mock';

// Minimal mock SyncService — captures calls but returns a predictable id
class MockSyncService {
  async createSyncAction(
    _orgId: string,
    _action: SyncActionType,
    _modelName: string,
    _modelId: string,
    _data: object | null,
  ) {
    return { id: BigInt(1) } as { id: bigint };
  }

  // In-transaction marker write (atomic-sync path). Returns the same
  // predictable id so resolvers that record-then-publish still assert '1'.
  async recordSyncAction(
    _client: unknown,
    _orgId: string,
    _action: SyncActionType,
    _modelName: string,
    _modelId: string,
    _data: object | null,
  ) {
    return { id: BigInt(1), organizationId: _orgId } as { id: bigint; organizationId: string };
  }

  // Post-commit Redis broadcast — no-op in tests.
  publish(_action: { id: bigint; organizationId: string }) {}
}

// Minimal mock WebhookService — webhooks are fire-and-forget, so the resolver
// only needs `dispatchEvent` to resolve without throwing. Returning an empty
// array mirrors the "no subscribers" path.
class MockWebhookService {
  async dispatchEvent(_orgId: string, _event: string, _data: object, _teamId?: string | null) {
    return [];
  }
}

export interface MockGraphQLContext {
  loaders: Loaders;
  orgId: string | null;
  prisma: MockPrismaClient;
  services: {
    analytics: AnalyticsService;
    auditLog: AuditLogService;
    auth: AuthService;
    automation: AutomationService;
    initiative: InitiativeService;
    issue: IssueService;
    issueActivity: IssueActivityService;
    label: LabelService;
    notification: NotificationService;
    organization: OrganizationService;
    platformAdmin: PlatformAdminService;
    saml: SamlService;
    scim: ScimService;
    search: SearchService;
    sync: MockSyncService;
    team: TeamService;
    triage: TriageService;
    user: UserService;
    webhook: MockWebhookService;
    workflowState: WorkflowStateService;
  };
  userId: string | null;
}

export function createMockContext(
  overrides: Partial<{ orgId: string | null; userId: string | null }> = {},
): MockGraphQLContext {
  const prisma = createMockPrisma();
  const userService = new UserService(prisma as never);

  const orgId = overrides.orgId !== undefined ? overrides.orgId : TEST_ORG.id;
  return {
    loaders: createLoaders(prisma as never, orgId),
    orgId,
    prisma,
    services: {
      analytics: new AnalyticsService(prisma as never),
      auditLog: new AuditLogService(prisma as never),
      auth: new AuthService(prisma as never, userService),
      automation: new AutomationService(prisma as never),
      initiative: new InitiativeService(prisma as never),
      issue: new IssueService(prisma as never),
      issueActivity: new IssueActivityService(prisma as never),
      label: new LabelService(prisma as never),
      notification: new NotificationService(prisma as never),
      organization: new OrganizationService(prisma as never),
      platformAdmin: new PlatformAdminService(prisma as never),
      saml: new SamlService(prisma as never),
      scim: new ScimService(prisma as never),
      search: new SearchService(prisma as never),
      sync: new MockSyncService(),
      team: new TeamService(prisma as never),
      triage: new TriageService(prisma as never),
      user: userService,
      webhook: new MockWebhookService(),
      workflowState: new WorkflowStateService(prisma as never),
    },
    userId: overrides.userId !== undefined ? overrides.userId : TEST_USER.id,
  };
}
