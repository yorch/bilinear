import type { NextRequest } from 'next/server';
import type { PrismaClient } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import type { AuthContext } from '../middleware/auth';
import { extractAuthContext } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { CustomViewService } from '../services/custom-view.service';
import { CycleService } from '../services/cycle.service';
import { IssueService } from '../services/issue.service';
import { LabelService } from '../services/label.service';
import { ProjectService } from '../services/project.service';
import { SearchService } from '../services/search.service';
import { SyncService } from '../services/sync.service';
import { TeamService } from '../services/team.service';
import { UserService } from '../services/user.service';
import { WorkflowStateService } from '../services/workflow-state.service';

export interface GraphQLContext extends AuthContext {
  prisma: PrismaClient;
  services: {
    auth: AuthService;
    customView: CustomViewService;
    cycle: CycleService;
    issue: IssueService;
    label: LabelService;
    project: ProjectService;
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
  const customViewService = new CustomViewService(prisma);
  const teamService = new TeamService(prisma);
  const workflowStateService = new WorkflowStateService(prisma);
  const cycleService = new CycleService(prisma);
  const issueService = new IssueService(prisma);
  const labelService = new LabelService(prisma);
  const projectService = new ProjectService(prisma);
  const syncService = new SyncService(prisma, redis);
  const searchService = new SearchService(prisma);

  return {
    ...auth,
    prisma,
    services: {
      auth: authService,
      customView: customViewService,
      cycle: cycleService,
      issue: issueService,
      label: labelService,
      project: projectService,
      search: searchService,
      sync: syncService,
      team: teamService,
      user: userService,
      workflowState: workflowStateService,
    },
  };
}
