import { redirect } from 'next/navigation';
import { prisma } from '@/server/lib/prisma';

/**
 * Workspace root — redirects to the first team's issue list.
 *
 * Linear-style: landing on /<workspace> always forwards you to the first
 * team so that all workspace-level URL assumptions in tests and the UI
 * are consistent.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;

  const org = await prisma.organization.findUnique({
    select: {
      teams: {
        orderBy: { createdAt: 'asc' },
        select: { key: true },
        take: 1,
      },
    },
    where: { urlKey: workspace },
  });

  const firstTeam = org?.teams[0];
  if (firstTeam) {
    redirect(`/${workspace}/team/${firstTeam.key}`);
  }

  // No teams yet — prompt the user to create one
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
      No teams yet. Create a team to get started.
    </div>
  );
}
