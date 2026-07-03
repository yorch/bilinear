'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { installSessionCookies } from '@/lib/auth-session';
import { gql } from '@/lib/graphql';
import { GITHUB_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { gqlError } from '@/lib/utils';

/**
 * Completes the GitHub OAuth login. GitHub redirects here with `code` and
 * `state`; the state must match the one stashed in sessionStorage by the
 * login form (same-browser CSRF check on top of the server's signed-state
 * verification). On success the token pair is exchanged into httpOnly
 * cookies via /api/auth/session.
 */
export function GithubCallbackHandler() {
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
      const storedState = sessionStorage.getItem('github_oauth_state');
      sessionStorage.removeItem('github_oauth_state');

      if (!code || !state || state !== storedState) {
        setError('Sign-in session expired or was tampered with. Please try again.');
        return;
      }

      try {
        const result = await gql(GITHUB_AUTH_EXCHANGE_MUTATION, { code, state });

        const payload = (
          result.data as {
            githubAuthExchange?: { accessToken: string; refreshToken: string };
          } | null
        )?.githubAuthExchange;
        if (!payload) {
          setError(gqlError(result, 'GitHub sign-in failed. Please try again.'));
          return;
        }

        if (!(await installSessionCookies(payload))) {
          setError('Failed to establish a session. Please try again.');
          return;
        }

        router.push('/');
      } catch {
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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Signing you in with GitHub…</p>
      )}
    </div>
  );
}
