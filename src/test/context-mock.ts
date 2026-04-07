import { AuthService } from '../server/services/auth.service';
import { IssueService } from '../server/services/issue.service';
import { LabelService } from '../server/services/label.service';
import { TeamService } from '../server/services/team.service';
import { UserService } from '../server/services/user.service';
import { WorkflowStateService } from '../server/services/workflow-state.service';
import { TEST_ORG, TEST_USER } from './fixtures';
import { createMockPrisma, type MockPrismaClient } from './prisma-mock';

export interface MockGraphQLContext {
  orgId: string | null;
  prisma: MockPrismaClient;
  services: {
    auth: AuthService;
    issue: IssueService;
    label: LabelService;
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
      label: new LabelService(prisma as never),
      team: new TeamService(prisma as never),
      user: userService,
      workflowState: new WorkflowStateService(prisma as never),
    },
    userId: overrides.userId !== undefined ? overrides.userId : TEST_USER.id,
  };
}
