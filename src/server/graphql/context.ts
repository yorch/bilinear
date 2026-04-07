import type { NextRequest } from 'next/server';
import type { PrismaClient } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import type { AuthContext } from '../middleware/auth';
import { extractAuthContext } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { IssueService } from '../services/issue.service';
import { LabelService } from '../services/label.service';
import { SearchService } from '../services/search.service';
import { SyncService } from '../services/sync.service';
import { TeamService } from '../services/team.service';
import { UserService } from '../services/user.service';
import { WorkflowStateService } from '../services/workflow-state.service';

export interface GraphQLContext extends AuthContext {
  prisma: PrismaClient;
  services: {
    auth: AuthService;
    issue: IssueService;
    label: LabelService;
    search: SearchService;
    sync: SyncService;
    team: TeamService;
    user: UserService;
    workflowState: WorkflowStateService;
  };
}

export async function createContext(req: NextRequest): Promise<GraphQLContext> {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('access_token')?.value ?? null;

  const auth = await extractAuthContext(authHeader, cookieToken);

  const userService = new UserService(prisma);
  const authService = new AuthService(prisma, userService);
  const teamService = new TeamService(prisma);
  const workflowStateService = new WorkflowStateService(prisma);
  const issueService = new IssueService(prisma);
  const labelService = new LabelService(prisma);
  const syncService = new SyncService(prisma, redis);
  const searchService = new SearchService(prisma);

  return {
    ...auth,
    prisma,
    services: {
      auth: authService,
      issue: issueService,
      label: labelService,
      search: searchService,
      sync: syncService,
      team: teamService,
      user: userService,
      workflowState: workflowStateService,
    },
  };
}
