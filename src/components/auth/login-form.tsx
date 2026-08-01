'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import {
  EMAIL_LOGIN_MUTATION,
  GITHUB_AUTH_START_QUERY,
  GOOGLE_AUTH_START_QUERY,
} from '@/lib/graphql-queries';
import { rememberPostAuthNext, safeRelativePath } from '@/lib/safe-path';
import { gqlError } from '@/lib/utils';

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations();
  // Where to land after signing in — set when the user arrived from a link
  // that needs a session (today: an invitation). Validated as an in-app path
  // before it reaches any navigation; see safeRelativePath.
  const next = safeRelativePath(useSearchParams().get('next'));
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await gql(EMAIL_LOGIN_MUTATION, { input: { email } });

      if (data.errors?.length) {
        setError((data.errors[0] as { message: string }).message);
        return;
      }

      // Carried in the URL rather than only in sessionStorage so the
      // verify step keeps the destination even though the two pages are
      // separate navigations. A magic link opened in a *different* tab has
      // no `next` and lands on the workspace root — the user can re-open
      // the original link, now signed in.
      const verifyUrl = next
        ? `/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`
        : `/verify?email=${encodeURIComponent(email)}`;
      router.push(verifyUrl);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground-secondary" htmlFor="email">
          {t('auth.emailAddress')}
        </label>
        <input
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-invert"
          id="email"
          onChange={e => setEmail(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
          required
          type="email"
          value={email}
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button className="w-full" data-testid="email-submit" disabled={loading} type="submit">
        {loading ? t('auth.sending') : t('auth.continueWithEmail')}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs text-muted-foreground">
          <span className="bg-background px-2">{t('common.or')}</span>
        </div>
      </div>

      <Button
        className="w-full"
        onClick={() =>
          startOAuth({
            field: 'googleAuthStart',
            label: 'Google',
            query: GOOGLE_AUTH_START_QUERY,
            storageKey: 'google_oauth_state',
          })
        }
        type="button"
        variant="outline"
      >
        {t('auth.continueWithGoogle')}
      </Button>

      <Button
        className="w-full"
        onClick={() =>
          startOAuth({
            field: 'githubAuthStart',
            label: 'GitHub',
            query: GITHUB_AUTH_START_QUERY,
            storageKey: 'github_oauth_state',
          })
        }
        type="button"
        variant="outline"
      >
        {t('auth.continueWithGitHub')}
      </Button>
    </form>
  );

  // Let the server own the OAuth URL (including redirect_uri and CSRF
  // state). Persist state to sessionStorage so the callback page can replay
  // it to the matching *AuthExchange mutation.
  async function startOAuth(provider: {
    field: string;
    label: string;
    query: string;
    storageKey: string;
  }) {
    try {
      // OAuth returns to a server-controlled redirect URI that carries none
      // of our query params, so the destination has to survive the round
      // trip out-of-band.
      rememberPostAuthNext(next);
      const result = await gql(provider.query);
      const payload = (result.data as Record<string, { url: string; state: string } | undefined>)?.[
        provider.field
      ];
      if (!payload) {
        setError(gqlError(result, t('auth.failedToStart', { provider: provider.label })));
        return;
      }
      sessionStorage.setItem(provider.storageKey, payload.state);
      window.location.href = payload.url;
    } catch {
      setError(t('common.somethingWentWrong'));
    }
  }
}
