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
import { DocumentService } from '../services/document.service';
import { FavoriteService } from '../services/favorite.service';
import { FileService } from '../services/file.service';
import { GitHubService } from '../services/github.service';
import { InitiativeService } from '../services/initiative.service';
import { IssueService } from '../services/issue.service';
import { IssueActivityService } from '../services/issue-activity.service';
import { IssueRelationService } from '../services/issue-relation.service';
import { IssueTemplateService } from '../services/issue-template.service';
import { LabelService } from '../services/label.service';
import { NotificationService } from '../services/notification.service';
import { OrganizationService } from '../services/organization.service';
import { ProjectService } from '../services/project.service';
import { RoadmapService } from '../services/roadmap.service';
import { SearchService } from '../services/search.service';
import { SyncService } from '../services/sync.service';
import { TeamService } from '../services/team.service';
import { TriageService } from '../services/triage.service';
import { UserService } from '../services/user.service';
import { WebhookService } from '../services/webhook.service';
import { WorkflowStateService } from '../services/workflow-state.service';
import { createLoaders, type Loaders } from './loaders';

export interface GraphQLContext extends AuthContext {
  /** Best-effort client IP for abuse tracking (X-Forwarded-For / X-Real-IP). */
  clientIp: string | null;
  /** Per-request DataLoader bundle batching N+1 lookups. See ./loaders. */
  loaders: Loaders;
  prisma: PrismaClient;
  services: {
    auth: AuthService;
    comment: CommentService;
    github: GitHubService;
    customField: CustomFieldService;
    customView: CustomViewService;
    cycle: CycleService;
    document: DocumentService;
    favorite: FavoriteService;
    file: FileService;
    initiative: InitiativeService;
    issue: IssueService;
    issueActivity: IssueActivityService;
    issueRelation: IssueRelationService;
    issueTemplate: IssueTemplateService;
    label: LabelService;
    notification: NotificationService;
    organization: OrganizationService;
    project: ProjectService;
    roadmap: RoadmapService;
    search: SearchService;
    sync: SyncService;
    team: TeamService;
    triage: TriageService;
    user: UserService;
    webhook: WebhookService;
    workflowState: WorkflowStateService;
  };
}

function extractClientIp(req: NextRequest): string | null {
  // When TRUST_PROXY_HEADERS=1, read X-Forwarded-For / X-Real-IP. Deploy
  // this only when the upstream proxy strips client-supplied forwarding
  // headers (Vercel, Cloudflare, reverse-proxy with trust_forwarded, etc.).
  if (process.env.TRUST_PROXY_HEADERS === '1') {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }
    const realIp = req.headers.get('x-real-ip');
    if (realIp) {
      return realIp;
    }
  }
  // Fallback: NextRequest exposes the socket-level remote address. This
  // is the actual TCP peer — when the app runs without a proxy, it's
  // already the real client IP; behind a misconfigured proxy it'll be
  // the proxy itself, which still bounds the per-IP cap to one shared
  // bucket per upstream rather than disabling it entirely.
  const nextIp = (req as unknown as { ip?: string | null }).ip;
  return nextIp ?? null;
}

export async function createContext(req: NextRequest): Promise<GraphQLContext> {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('access_token')?.value ?? null;

  const auth = await extractAuthContext(authHeader, cookieToken);
  const clientIp = extractClientIp(req);

  const userService = new UserService(prisma);
  const authService = new AuthService(prisma, userService);
  const githubService = new GitHubService(prisma);
  const documentService = new DocumentService(prisma);
  const favoriteService = new FavoriteService(prisma);
  const fileService = new FileService(prisma);
  const commentService = new CommentService(prisma);
  const customFieldService = new CustomFieldService(prisma);
  const customViewService = new CustomViewService(prisma);
  const issueActivityService = new IssueActivityService(prisma);
  const notificationService = new NotificationService(prisma);
  const organizationService = new OrganizationService(prisma);
  const teamService = new TeamService(prisma);
  const workflowStateService = new WorkflowStateService(prisma);
  const cycleService = new CycleService(prisma);
  const initiativeService = new InitiativeService(prisma);
  const issueService = new IssueService(prisma);
  const issueRelationService = new IssueRelationService(prisma);
  const issueTemplateService = new IssueTemplateService(prisma);
  const labelService = new LabelService(prisma);
  const projectService = new ProjectService(prisma);
  const roadmapService = new RoadmapService(prisma);
  const syncService = new SyncService(prisma, redis);
  const searchService = new SearchService(prisma);
  const triageService = new TriageService(prisma);
  const webhookService = new WebhookService(prisma);

  return {
    ...auth,
    clientIp,
    loaders: createLoaders(prisma, auth.orgId),
    prisma,
    services: {
      auth: authService,
      comment: commentService,
      customField: customFieldService,
      customView: customViewService,
      cycle: cycleService,
      document: documentService,
      favorite: favoriteService,
      file: fileService,
      github: githubService,
      initiative: initiativeService,
      issue: issueService,
      issueActivity: issueActivityService,
      issueRelation: issueRelationService,
      issueTemplate: issueTemplateService,
      label: labelService,
      notification: notificationService,
      organization: organizationService,
      project: projectService,
      roadmap: roadmapService,
      search: searchService,
      sync: syncService,
      team: teamService,
      triage: triageService,
      user: userService,
      webhook: webhookService,
      workflowState: workflowStateService,
    },
  };
}
