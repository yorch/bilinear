'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { enterWorkspace } from '@/hooks/use-organization-switch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { ORGANIZATION_INVITE_ACCEPT_MUTATION } from '@/lib/graphql-queries';
import { createClientLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/utils';

const log = createClientLogger('InviteAcceptPanel');

interface InviteAcceptPanelProps {
  invitedEmail: string;
  inviterName: string | null;
  organizationName: string;
  role: string;
  token: string;
  /** Email of the signed-in viewer, or null when signed out. */
  viewerEmail: string | null;
}

export function InviteAcceptPanel({
  invitedEmail,
  inviterName,
  organizationName,
  role,
  token,
  viewerEmail,
}: InviteAcceptPanelProps) {
  const t = useTranslations();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mailbox capitalization isn't meaningful to people, and the server
  // compares case-insensitively too — matching that here keeps the UI from
  // claiming a mismatch the server would happily accept.
  const matches = viewerEmail?.toLowerCase() === invitedEmail.toLowerCase();

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const payload = await gqlQuery<Parameters<typeof enterWorkspace>[0]>(
        ORGANIZATION_INVITE_ACCEPT_MUTATION,
        { token },
        'organizationInviteAccept',
      );
      // Same handoff as switching workspaces: cookies, then a full document
      // load so the new org bootstraps from a clean cache.
      await enterWorkspace(payload);
    } catch (err) {
      log.error('Accept failed', err);
      setError(getErrorMessage(err, t('invite.acceptFailed')));
      setAccepting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
        {t('invite.title')}
      </h1>
      <p className="text-sm text-foreground-secondary">
        {inviterName
          ? t('invite.invitedBy', { inviter: inviterName, organization: organizationName })
          : t('invite.invitedTo', { organization: organizationName })}
      </p>
      <p className="text-sm text-muted-foreground">{t('invite.invitedAs', { role })}</p>

      {matches ? (
        <Button disabled={accepting} onClick={() => void handleAccept()}>
          {accepting ? t('invite.accepting') : t('invite.accept')}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {viewerEmail
              ? t('invite.wrongAccount', { current: viewerEmail, email: invitedEmail })
              : t('invite.signInPrompt', { email: invitedEmail })}
          </p>
          {/* `next` brings them back here after signing in, so the invitation
              survives the detour instead of dumping them in a workspace. */}
          <Button asChild>
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
              {t('invite.signInCta')}
            </Link>
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-danger-subtle-foreground">{error}</p>}
    </div>
  );
}
