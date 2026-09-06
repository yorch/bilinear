import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { getSyncVisibility } from '@/server/lib/sync-visibility';
import { requireAuthContext } from '@/server/middleware/auth';
import { SyncService } from '@/server/services/sync.service';

/**
 * GET /api/sync/bootstrap
 *
 * Returns all data for the authenticated user's organization as a
 * line-delimited stream: each line is `ModelName=<JSON>`, terminated by
 * `_metadata_={"lastSyncId":"<N>"}`.
 */
async function handleGet(req: NextRequest) {
  // Routed through requireAuthContext (not a raw verifyAccessToken call) so
  // a deactivated user or a suspended/archived org is rejected here too —
  // it re-checks both against the DB on every request instead of trusting
  // the JWT claims for the token's full lifetime. Also picks up API-key
  // (`bil_...`) auth for free, matching the GraphQL route's auth surface.
  const authResult = await requireAuthContext(req, prisma);
  if ('response' in authResult) {
    return authResult.response;
  }
  const { orgId, userId } = authResult.ctx;
  bindRequestContext({ orgId });

  const visibility = await getSyncVisibility(prisma, userId, orgId);
  const syncService = new SyncService(prisma, redis);

  try {
    const data = await syncService.getBootstrapData(orgId, visibility);

    const lines: string[] = [];

    for (const org of data.organizations) {
      lines.push(`Organization=${JSON.stringify(org)}`);
    }
    for (const member of data.organizationMembers) {
      lines.push(`OrganizationMember=${JSON.stringify(member)}`);
    }
    for (const team of data.teams) {
      lines.push(`Team=${JSON.stringify(team)}`);
    }
    for (const user of data.users) {
      lines.push(`User=${JSON.stringify(user)}`);
    }
    for (const state of data.workflowStates) {
      lines.push(`WorkflowState=${JSON.stringify(state)}`);
    }
    for (const label of data.issueLabels) {
      lines.push(`IssueLabel=${JSON.stringify(label)}`);
    }
    for (const issue of data.issues) {
      lines.push(`Issue=${JSON.stringify(issue)}`);
    }
    for (const project of data.projects) {
      lines.push(`Project=${JSON.stringify(project)}`);
    }
    for (const milestone of data.projectMilestones) {
      lines.push(`ProjectMilestone=${JSON.stringify(milestone)}`);
    }
    for (const update of data.projectUpdates) {
      lines.push(`ProjectUpdate=${JSON.stringify(update)}`);
    }
    for (const cycle of data.cycles) {
      lines.push(`Cycle=${JSON.stringify(cycle)}`);
    }
    for (const view of data.customViews) {
      lines.push(`CustomView=${JSON.stringify(view)}`);
    }
    for (const relation of data.issueRelations) {
      lines.push(`IssueRelation=${JSON.stringify(relation)}`);
    }
    for (const template of data.issueTemplates) {
      lines.push(`IssueTemplate=${JSON.stringify(template)}`);
    }
    for (const def of data.customFieldDefinitions) {
      lines.push(`CustomFieldDefinition=${JSON.stringify(def)}`);
    }
    for (const val of data.customFieldValues) {
      lines.push(`CustomFieldValue=${JSON.stringify(val)}`);
    }
    for (const doc of data.documents) {
      lines.push(`Document=${JSON.stringify(doc)}`);
    }
    for (const initiative of data.initiatives) {
      lines.push(`Initiative=${JSON.stringify(initiative)}`);
    }
    for (const link of data.initiativeProjects) {
      lines.push(`InitiativeProject=${JSON.stringify(link)}`);
    }

    lines.push(`_metadata_=${JSON.stringify({ lastSyncId: data.lastSyncId })}`);

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 200,
    });
  } catch (err) {
    logger.error({ err }, 'Bootstrap failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withRequestContext('sync/bootstrap', handleGet);
