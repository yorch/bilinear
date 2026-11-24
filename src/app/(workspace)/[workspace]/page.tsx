import { redirect } from 'next/navigation';
import { pickLandingTeamKey } from '@/server/lib/landing-team';
import { prisma } from '@/server/lib/prisma';
import { readSessionClaim } from '@/server/lib/session-claim';
import { WorkspaceNoTeams } from './workspace-no-teams';

/**
 * Workspace root — redirects to the first team the viewer can open.
 *
 * Linear-style: landing on /<workspace> always forwards you to the first
 * accessible team (private teams you are not in are skipped) so that all workspace-level URL assumptions in tests and the UI
 * are consistent.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;

  const claim = await readSessionClaim();
  const org = await prisma.organization.findUnique({
    select: {
      id: true,
      members: {
        select: { role: true },
        where: { userId: claim?.userId ?? '' },
      },
      teams: {
        orderBy: { createdAt: 'asc' },
        select: {
          key: true,
          memberships: { select: { id: true }, take: 1, where: { userId: claim?.userId ?? '' } },
          private: true,
        },
        where: { archivedAt: null },
      },
    },
    where: { urlKey: workspace },
  });

  const role = org?.members[0]?.role;
  const landingKey = pickLandingTeamKey(
    (org?.teams ?? []).map(t => ({
      isMember: t.memberships.length > 0,
      key: t.key,
      private: t.private,
    })),
    role === 'owner' || role === 'admin',
  );
  if (landingKey) {
    redirect(`/${workspace}/team/${landingKey}`);
  }

  // No teams yet — prompt the user to create one
  return <WorkspaceNoTeams />;
}
