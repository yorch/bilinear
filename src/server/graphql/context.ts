import type { NextRequest } from 'next/server';
import type { PrismaClient } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import type { AuthContext } from '../middleware/auth';
import { extractAuthContext } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { CommentService } from '../services/comment.service';
import { CustomFieldService } from '../services/custom-field.service';
import { CustomViewService } from '../services/custom-view.service';
import { CycleService } from '../services/cycle.service';
import { FileService } from '../services/file.service';
import { IssueService } from '../services/issue.service';
import { IssueActivityService } from '../services/issue-activity.service';
import { IssueRelationService } from '../services/issue-relation.service';
import { IssueTemplateService } from '../services/issue-template.service';
import { LabelService } from '../services/label.service';
import { NotificationService } from '../services/notification.service';
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
    comment: CommentService;
    customField: CustomFieldService;
    customView: CustomViewService;
    cycle: CycleService;
    file: FileService;
    issue: IssueService;
    issueActivity: IssueActivityService;
    issueRelation: IssueRelationService;
    issueTemplate: IssueTemplateService;
    label: LabelService;
    notification: NotificationService;
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
  const fileService = new FileService(prisma);
  const commentService = new CommentService(prisma);
  const customFieldService = new CustomFieldService(prisma);
  const customViewService = new CustomViewService(prisma);
  const issueActivityService = new IssueActivityService(prisma);
  const notificationService = new NotificationService(prisma);
  const teamService = new TeamService(prisma);
  const workflowStateService = new WorkflowStateService(prisma);
  const cycleService = new CycleService(prisma);
  const issueService = new IssueService(prisma);
  const issueRelationService = new IssueRelationService(prisma);
  const issueTemplateService = new IssueTemplateService(prisma);
  const labelService = new LabelService(prisma);
  const projectService = new ProjectService(prisma);
  const syncService = new SyncService(prisma, redis);
  const searchService = new SearchService(prisma);

  return {
    ...auth,
    prisma,
    services: {
      auth: authService,
      comment: commentService,
      customField: customFieldService,
      customView: customViewService,
      cycle: cycleService,
      file: fileService,
      issue: issueService,
      issueActivity: issueActivityService,
      issueRelation: issueRelationService,
      issueTemplate: issueTemplateService,
      label: labelService,
      notification: notificationService,
      project: projectService,
      search: searchService,
      sync: syncService,
      team: teamService,
      user: userService,
      workflowState: workflowStateService,
    },
  };
}
