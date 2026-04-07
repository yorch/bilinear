import type { NextRequest } from 'next/server';
import type { PrismaClient } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import type { AuthContext } from '../middleware/auth';
import { extractAuthContext } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { TeamService } from '../services/team.service';
import { UserService } from '../services/user.service';
import { WorkflowStateService } from '../services/workflow-state.service';

export interface GraphQLContext extends AuthContext {
  prisma: PrismaClient;
  services: {
    auth: AuthService;
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

  return {
    ...auth,
    prisma,
    services: {
      auth: authService,
      team: teamService,
      user: userService,
      workflowState: workflowStateService,
    },
  };
}
