import { redirect } from 'next/navigation';
import { WorkspaceMismatch } from '@/components/layouts/workspace-mismatch';
import { prisma } from '@/server/lib/prisma';
import { readSessionClaim } from '@/server/lib/session-claim';
import { UserService } from '@/server/services/user.service';

/**
 * Makes the `[workspace]` URL segment mean something.
 *
 * Before multi-org it was decorative: every route below it read its data
 * from the session's `orgId` claim and ignored the segment entirely, so
 * `/other-org/team/ENG` rendered *your* org's ENG team under someone else's
 * url key. Harmless while an account had exactly one workspace — the
 * segment could only ever be your own — but once a user can hold several,
 * a stale bookmark or a link from a colleague silently shows the wrong
 * tenant's data under the right tenant's URL.
 *
 * So the segment is now checked against the session:
 *
 * - **Match** — render the workspace.
 * - **Mismatch, and the viewer belongs to the org in the URL** — render an
 *   interstitial offering to switch. Deliberately *not* an automatic
 *   switch: re-issuing someone's session is a real side effect, and doing
 *   it because they followed a GET link is how you get a link that logs a
 *   user out of what they were doing. The interstitial is a client
 *   component, so it can read the full path and land the user on the exact
 *   page they were linked to.
 * - **Mismatch, and they don't belong to it (or it's archived/suspended)** —
 *   redirect to `/`, which resolves whichever workspace they *can* open.
 *   No 404: whether a given url key exists is not this page's news to give.
 */
export default async function WorkspaceGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const claim = await readSessionClaim();
  if (!claim) {
    redirect('/login');
  }

  const urlOrg = await prisma.organization.findUnique({
    select: { id: true, name: true },
    where: { urlKey: workspace },
  });

  if (urlOrg && urlOrg.id === claim.orgId) {
    return <>{children}</>;
  }

  // The session's own org is re-derived rather than trusted, so a claim
  // that has since been revoked doesn't leave the user staring at a switch
  // prompt for a workspace they're already supposed to be in.
  const userService = new UserService(prisma);
  const target = urlOrg ? await userService.findUsableMembership(claim.userId, urlOrg.id) : null;

  if (!target) {
    redirect('/');
  }

  return (
    <WorkspaceMismatch name={target.organization.name} organizationId={target.organization.id} />
  );
}
