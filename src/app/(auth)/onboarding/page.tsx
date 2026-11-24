import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/auth/onboarding-flow';
import { parseResumeStep } from '@/components/auth/onboarding-steps';
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

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string | string[]; step?: string | string[] }>;
}) {
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

  // A reload mid-flow: `?step=team&org=<key>` restores steps 2-3, but only for a
  // workspace this viewer owns — the URL is attacker-editable.
  const { org: orgParam, step: stepParam } = await searchParams;
  const resumeStep = parseResumeStep(stepParam);
  const resumeKey = Array.isArray(orgParam) ? orgParam[0] : orgParam;
  const owned =
    resumeStep && resumeKey
      ? await prisma.organizationMember.findFirst({
          include: { organization: true },
          where: {
            organization: { archivedAt: null, suspendedAt: null, urlKey: resumeKey },
            role: 'owner',
            userId: claim.userId,
          },
        })
      : null;

  return (
    <OnboardingFlow
      backTo={
        membership
          ? { name: membership.organization.name, urlKey: membership.organization.urlKey }
          : null
      }
      defaultName={user?.name ?? ''}
      host={host}
      resume={
        owned && resumeStep
          ? { name: owned.organization.name, step: resumeStep, urlKey: owned.organization.urlKey }
          : null
      }
    />
  );
}
