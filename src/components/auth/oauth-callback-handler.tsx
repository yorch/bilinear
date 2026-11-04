'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AuthHeader } from '@/components/auth/auth-header';
import { beginOAuth, type OAuthStartConfig } from '@/components/auth/oauth-start';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { installSessionCookies } from '@/lib/auth-session';
import { gql } from '@/lib/graphql';
import { createClientLogger } from '@/lib/logger';
import { consumePostAuthNext } from '@/lib/safe-path';
import { gqlError } from '@/lib/utils';

const log = createClientLogger('OAuthCallback');

/**
 * Configuration for one OAuth login provider: the shared start/storage
 * descriptor from `oauth-start.ts` (so the start and callback halves cannot
 * drift) plus the `*AuthExchange` mutation string this page replays `state` to.
 */
export interface OAuthProvider extends OAuthStartConfig {
  mutation: string;
}

/**
 * Completes an OAuth login. The provider redirects here with `code` and
 * `state`; the state must match the one stashed in sessionStorage by the
 * login form (same-browser CSRF check on top of the server's signed-state
 * verification). On success the token pair is exchanged into httpOnly
 * cookies via /api/auth/session.
 */
export function OAuthCallbackHandler({ provider }: { provider: OAuthProvider }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // The OAuth code is single-use and the stored state is consumed on read, so
  // the exchange must run exactly once even if the effect re-fires (React
  // StrictMode double-invokes mount effects in dev).
  const startedRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    async function exchange() {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const storedState = sessionStorage.getItem(provider.storageKey);
      sessionStorage.removeItem(provider.storageKey);

      if (!code || !state || state !== storedState) {
        // Expected-degraded (expired session / reopened tab / tampering) —
        // breadcrumb only, not a Sentry event.
        log.warn('Missing or mismatched OAuth state', undefined, { provider: provider.label });
        setError(t('auth.sessionExpiredOrTampered'));
        return;
      }

      try {
        const result = await gql(provider.mutation, { code, state });

        const payload = (
          result.data as Record<string, { accessToken: string; refreshToken: string } | undefined>
        )?.[provider.exchangeField];
        if (!payload) {
          log.error('OAuth exchange returned no session', undefined, {
            provider: provider.label,
          });
          setError(gqlError(result, t('auth.oauthSignInFailed', { provider: provider.label })));
          return;
        }

        if (!(await installSessionCookies(payload))) {
          log.error('Failed to install session cookies', undefined, {
            provider: provider.label,
          });
          setError(t('auth.failedToEstablishSession'));
          return;
        }

        // Restores the destination stashed before the OAuth redirect (an
        // invitation link, typically); falls back to '/' for a plain login.
        router.push(consumePostAuthNext());
      } catch (err) {
        log.error('OAuth exchange threw', err, { provider: provider.label });
        setError(t('common.somethingWentWrong'));
      }
    }

    exchange();
  }, []);

  async function retry() {
    setRetrying(true);
    try {
      const failure = await beginOAuth(
        provider,
        t('auth.failedToStart', { provider: provider.label }),
      );
      if (failure) {
        setError(failure);
        setRetrying(false);
      }
    } catch {
      setError(t('common.somethingWentWrong'));
      setRetrying(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6" role="alert">
        <AuthHeader brandMark subtitle={error} title={t('auth.oauthErrorTitle')} />
        <div className="flex flex-col gap-2">
          <Button disabled={retrying} onClick={() => void retry()} type="button">
            {t('auth.retryWithProvider', { provider: provider.label })}
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">{t('auth.backToSignIn')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center gap-2.5 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      {t('auth.signingInWithProvider', { provider: provider.label })}
    </div>
  );
}
