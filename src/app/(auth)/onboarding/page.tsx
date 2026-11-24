import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/auth/onboarding-flow';
import { titleMetadata } from '@/lib/page-metadata';
import { prisma } from '@/server/lib/prisma';
import { readSessionClaim } from '@/server/lib/session-claim';
import { UserService } from '@/server/services/user.service';

export async function generateMetadata() {
  return {
    ...(await titleMetadata('meta.createWorkspace')),
    robots: { follow: false, index: false },
  };
}

export default async function OnboardingPage() {
  // Creating a workspace needs an account. A signed-out visitor used to get the
  // form and a failure on submit; send them to sign in and bring them back.
  const claim = await readSessionClaim();
  if (!claim) {
    redirect(`/login?next=${encodeURIComponent('/onboarding')}`);
  }

  const requestHeaders = await headers();
  // The workspace URL prefix is the host this deployment is actually served
  // from, not a hardcoded product domain.
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';

  const userService = new UserService(prisma);
  const [user, membership] = await Promise.all([
    userService.findById(claim.userId),
    // Someone creating a *second* workspace has somewhere to go back to.
    claim.orgId ? userService.findUsableMembership(claim.userId, claim.orgId) : null,
  ]);

  return (
    <OnboardingFlow
      backTo={
        membership
          ? { name: membership.organization.name, urlKey: membership.organization.urlKey }
          : null
      }
      defaultName={user?.name ?? ''}
      host={host}
    />
  );
}
