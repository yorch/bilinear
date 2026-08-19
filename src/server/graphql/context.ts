import type { NextRequest } from 'next/server';
import type { PrismaClient } from '../../generated/prisma';
import { config, startConfigInvalidation } from '../config';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getClientIp } from '../lib/request-security';
import type { AuthContext } from '../middleware/auth';
import { extractAuthContext } from '../middleware/auth';
import { AiService } from '../services/ai.service';
import { AnalyticsService } from '../services/analytics.service';
import { AuditLogService } from '../services/audit-log.service';
import { AuthService } from '../services/auth.service';
import { AutomationService } from '../services/automation.service';
import { CommentService } from '../services/comment.service';
import { CustomFieldService } from '../services/custom-field.service';
import { CustomViewService } from '../services/custom-view.service';
import { CycleService } from '../services/cycle.service';
import { DocumentService } from '../services/document.service';
import { FavoriteService } from '../services/favorite.service';
import { FileService } from '../services/file.service';
import { GitHubService } from '../services/github.service';
import { ImportService } from '../services/import.service';
import { InitiativeService } from '../services/initiative.service';
import { IssueService } from '../services/issue.service';
import { IssueActivityService } from '../services/issue-activity.service';
import { IssueRelationService } from '../services/issue-relation.service';
import { IssueTemplateService } from '../services/issue-template.service';
import { LabelService } from '../services/label.service';
import { NotificationService } from '../services/notification.service';
import { OrganizationService } from '../services/organization.service';
import { OrganizationInviteService } from '../services/organization-invite.service';
import { PlatformAdminService } from '../services/platform-admin.service';
import { ProjectService } from '../services/project.service';
import { RoadmapService } from '../services/roadmap.service';
import { SamlService } from '../services/saml.service';
import { ScimService } from '../services/scim.service';
import { SearchService } from '../services/search.service';
import { SlackService } from '../services/slack.service';
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
  /**
   * Layered configuration reader. The process-wide singleton, not a
   * per-request instance — its snapshot and Redis invalidation are shared with
   * the WS and YJS processes, neither of which has a GraphQL request at all.
   */
  config: typeof config;
  /** Per-request DataLoader bundle batching N+1 lookups. See ./loaders. */
  loaders: Loaders;
  prisma: PrismaClient;
  services: {
    ai: AiService;
    analytics: AnalyticsService;
    auditLog: AuditLogService;
    auth: AuthService;
    automation: AutomationService;
    comment: CommentService;
    github: GitHubService;
    import: ImportService;
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
    organizationInvite: OrganizationInviteService;
    platformAdmin: PlatformAdminService;
    project: ProjectService;
    roadmap: RoadmapService;
    saml: SamlService;
    scim: ScimService;
    search: SearchService;
    slack: SlackService;
    sync: SyncService;
    team: TeamService;
    triage: TriageService;
    user: UserService;
    webhook: WebhookService;
    workflowState: WorkflowStateService;
  };
}

export async function createContext(req: NextRequest): Promise<GraphQLContext> {
  // Idempotent. Subscribing here rather than at module load keeps the
  // subscription off the `next build` path, which imports this module without
  // a reachable Redis.
  startConfigInvalidation();

  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('access_token')?.value ?? null;

  const auth = await extractAuthContext(authHeader, cookieToken, prisma);
  const clientIp = getClientIp(req);

  const userService = new UserService(prisma);
  const auditLogService = new AuditLogService(prisma);
  const authService = new AuthService(prisma, userService);
  const analyticsService = new AnalyticsService(prisma);
  const githubService = new GitHubService(prisma);
  const documentService = new DocumentService(prisma);
  const favoriteService = new FavoriteService(prisma);
  const fileService = new FileService(prisma);
  const commentService = new CommentService(prisma);
  const customFieldService = new CustomFieldService(prisma, config);
  const customViewService = new CustomViewService(prisma);
  const issueActivityService = new IssueActivityService(prisma);
  const notificationService = new NotificationService(prisma);
  const organizationService = new OrganizationService(prisma);
  const organizationInviteService = new OrganizationInviteService(prisma, config);
  const platformAdminService = new PlatformAdminService(prisma, config);
  const teamService = new TeamService(prisma);
  const workflowStateService = new WorkflowStateService(prisma);
  const cycleService = new CycleService(prisma, config);
  const issueService = new IssueService(prisma);
  const importService = new ImportService(prisma, issueService, config);
  const issueRelationService = new IssueRelationService(prisma);
  const issueTemplateService = new IssueTemplateService(prisma);
  const labelService = new LabelService(prisma, config);
  const projectService = new ProjectService(prisma);
  const initiativeService = new InitiativeService(prisma, projectService, config);
  const roadmapService = new RoadmapService(prisma);
  const syncService = new SyncService(prisma, redis);
  const searchService = new SearchService(prisma);
  const aiService = new AiService(prisma, searchService, config);
  const slackService = new SlackService(prisma, issueService);
  const samlService = new SamlService(prisma);
  const scimService = new ScimService(prisma);
  const triageService = new TriageService(prisma);
  const webhookService = new WebhookService(prisma, config);
  // AutomationService wraps issueService.update + syncService.createSyncAction
  // for action side effects, so other clients see automation writes in real
  // time and lifecycle stamping happens identically to user-initiated updates.
  // Constructed after its deps; the engine itself is otherwise stateless.
  const automationService = new AutomationService(prisma, {
    issue: issueService,
    sync: syncService,
  });

  return {
    ...auth,
    clientIp,
    config,
    loaders: createLoaders(prisma, auth.orgId),
    prisma,
    services: {
      ai: aiService,
      analytics: analyticsService,
      auditLog: auditLogService,
      auth: authService,
      automation: automationService,
      comment: commentService,
      customField: customFieldService,
      customView: customViewService,
      cycle: cycleService,
      document: documentService,
      favorite: favoriteService,
      file: fileService,
      github: githubService,
      import: importService,
      initiative: initiativeService,
      issue: issueService,
      issueActivity: issueActivityService,
      issueRelation: issueRelationService,
      issueTemplate: issueTemplateService,
      label: labelService,
      notification: notificationService,
      organization: organizationService,
      organizationInvite: organizationInviteService,
      platformAdmin: platformAdminService,
      project: projectService,
      roadmap: roadmapService,
      saml: samlService,
      scim: scimService,
      search: searchService,
      slack: slackService,
      sync: syncService,
      team: teamService,
      triage: triageService,
      user: userService,
      webhook: webhookService,
      workflowState: workflowStateService,
    },
  };
}
