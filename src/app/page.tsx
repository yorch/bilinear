import { redirect } from 'next/navigation';
import { readSessionClaim } from '@/server/lib/session-claim';
import { UserService } from '@/server/services/user.service';
import { prisma } from '../server/lib/prisma';

/**
 * Entry point: send an authenticated visitor to a workspace they can
 * actually open.
 *
 * The session's `orgId` claim is a starting guess, not an answer. It is
 * stamped when the token is issued and lives for 24h, so by the time it is
 * read here the org may have been suspended or archived, or the user may
 * have been removed from it — and with multi-org accounts, being removed
 * from one workspace while still belonging to others is an ordinary event
 * rather than a dead end. So the claim is verified against a live
 * membership, and falls back to the user's default org when it no longer
 * holds.
 */
export default async function RootPage() {
  const claim = await readSessionClaim();
  if (!claim) {
    redirect('/login');
  }

  const userService = new UserService(prisma);

  // Both lookups filter out archived/suspended orgs, so whichever wins is a
  // workspace the session can enter.
  const org =
    (claim.orgId
      ? (await userService.findUsableMembership(claim.userId, claim.orgId))?.organization
      : null) ?? (await userService.getOrganizationForUser(claim.userId));

  if (org) {
    redirect(`/${org.urlKey}`);
  }

  // Authenticated but no workspace they can enter — send to onboarding
  redirect('/onboarding');
}
