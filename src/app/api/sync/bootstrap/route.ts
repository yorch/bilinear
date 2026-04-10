import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import { SyncService } from '@/server/services/sync.service';

/**
 * GET /api/sync/bootstrap
 *
 * Returns all data for the authenticated user's organization as a
 * line-delimited stream: each line is `ModelName=<JSON>`, terminated by
 * `_metadata_={"lastSyncId":"<N>"}`.
 */
export async function GET(req: NextRequest) {
  const token =
    req.cookies.get('access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let orgId: string;
  try {
    ({ orgId } = await verifyAccessToken(token));
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const syncService = new SyncService(prisma, redis);

  try {
    const data = await syncService.getBootstrapData(orgId);

    const lines: string[] = [];

    for (const org of data.organizations) {
      lines.push(`Organization=${JSON.stringify(org)}`);
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

    lines.push(`_metadata_=${JSON.stringify({ lastSyncId: data.lastSyncId })}`);

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 200,
    });
  } catch (err) {
    console.error('[sync/bootstrap] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
