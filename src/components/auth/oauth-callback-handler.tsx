'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { installSessionCookies } from '@/lib/auth-session';
import { gql } from '@/lib/graphql';
import { createClientLogger } from '@/lib/logger';
import { gqlError } from '@/lib/utils';

const log = createClientLogger('OAuthCallback');

/**
 * Configuration for one OAuth login provider. Mirrors the `startOAuth`
 * descriptor in `login-form.tsx` so the start and callback halves stay
 * symmetric: the login form stashes `state` under `storageKey` and the
 * callback replays it to `mutation`'s `exchangeField`.
 */
export interface OAuthProvider {
  /** The mutation's response field, e.g. "googleAuthExchange". */
  exchangeField: string;
  /** Human-readable name shown in status/error copy, e.g. "Google". */
  label: string;
  /** The `*AuthExchange` mutation string from `@/lib/graphql-queries`. */
  mutation: string;
  /** sessionStorage key the login form stored the CSRF `state` under. */
  storageKey: string;
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
  const [error, setError] = useState<string | null>(null);
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
        setError('Sign-in session expired or was tampered with. Please try again.');
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
          setError(gqlError(result, `${provider.label} sign-in failed. Please try again.`));
          return;
        }

        if (!(await installSessionCookies(payload))) {
          log.error('Failed to install session cookies', undefined, {
            provider: provider.label,
          });
          setError('Failed to establish a session. Please try again.');
          return;
        }

        router.push('/');
      } catch (err) {
        log.error('OAuth exchange threw', err, { provider: provider.label });
        setError('Something went wrong. Please try again.');
      }
    }

    exchange();
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {error ? (
        <>
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
          <button
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            onClick={() => router.push('/login')}
            type="button"
          >
            Back to sign in
          </button>
        </>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Signing you in with {provider.label}…
        </p>
      )}
    </div>
  );
}
