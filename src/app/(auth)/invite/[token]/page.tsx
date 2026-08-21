import { InviteAcceptPanel } from '@/components/auth/invite-accept-panel';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';
import { prisma } from '@/server/lib/prisma';
import { readSessionClaim } from '@/server/lib/session-claim';
import { OrganizationInviteService } from '@/server/services/organization-invite.service';

export async function generateMetadata() {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t('invite.title')} — ${appName}` };
}

/**
 * Invitation acceptance.
 *
 * Resolves the token server-side rather than through the GraphQL preview
 * query so the page renders its real state on first paint — an invitation is
 * usually opened from an email by someone with no session, and a
 * spinner-then-content flip is a poor first impression of a product they
 * haven't joined yet.
 *
 * The token is in the URL, which means it lands in browser history and any
 * referrer. That's the standard tradeoff for emailed links (magic-link
 * sign-in has it too), and it's bounded here by the invitation being
 * single-use, 7-day, and — unlike a bearer link — useless without a session
 * whose email matches.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getServerTranslations();

  const invite = await new OrganizationInviteService(prisma).findLiveByToken(token);

  if (!invite) {
    return (
      <div className="flex flex-col gap-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          {t('invite.expiredTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('invite.expiredBody')}</p>
      </div>
    );
  }

  // Resolve the viewer's email so the panel can tell "sign in to accept"
  // apart from "you're signed in as the wrong person" — two states that look
  // identical from the client but need very different instructions.
  const claim = await readSessionClaim();

  // Independent of each other once the invitation resolved.
  const [viewer, inviter] = await Promise.all([
    claim ? prisma.user.findUnique({ select: { email: true }, where: { id: claim.userId } }) : null,
    invite.invitedById
      ? prisma.user.findUnique({
          select: { displayName: true, name: true },
          where: { id: invite.invitedById },
        })
      : null,
  ]);

  return (
    <InviteAcceptPanel
      invitedEmail={invite.email}
      inviterName={inviter?.displayName ?? inviter?.name ?? null}
      organizationName={invite.organization.name}
      role={invite.role}
      token={token}
      viewerEmail={viewer?.email ?? null}
    />
  );
}
