import { AuthService } from '../server/services/auth.service';
import { IssueService } from '../server/services/issue.service';
import { IssueActivityService } from '../server/services/issue-activity.service';
import { LabelService } from '../server/services/label.service';
import { SearchService } from '../server/services/search.service';
import type { SyncActionType } from '../server/services/sync.service';
import { TeamService } from '../server/services/team.service';
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
}

export interface MockGraphQLContext {
  orgId: string | null;
  prisma: MockPrismaClient;
  services: {
    auth: AuthService;
    issue: IssueService;
    issueActivity: IssueActivityService;
    label: LabelService;
    search: SearchService;
    sync: MockSyncService;
    team: TeamService;
    user: UserService;
    workflowState: WorkflowStateService;
  };
  userId: string | null;
}

export function createMockContext(
  overrides: Partial<{ orgId: string | null; userId: string | null }> = {},
): MockGraphQLContext {
  const prisma = createMockPrisma();
  const userService = new UserService(prisma as never);

  return {
    orgId: overrides.orgId !== undefined ? overrides.orgId : TEST_ORG.id,
    prisma,
    services: {
      auth: new AuthService(prisma as never, userService),
      issue: new IssueService(prisma as never),
      issueActivity: new IssueActivityService(prisma as never),
      label: new LabelService(prisma as never),
      search: new SearchService(prisma as never),
      sync: new MockSyncService(),
      team: new TeamService(prisma as never),
      user: userService,
      workflowState: new WorkflowStateService(prisma as never),
    },
    userId: overrides.userId !== undefined ? overrides.userId : TEST_USER.id,
  };
}
