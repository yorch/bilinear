'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import {
  EMAIL_LOGIN_MUTATION,
  GITHUB_AUTH_START_QUERY,
  GOOGLE_AUTH_START_QUERY,
} from '@/lib/graphql-queries';
import { gqlError } from '@/lib/utils';

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations();
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

      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="email">
          {t('auth.emailAddress')}
        </label>
        <input
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-100"
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
          <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
        </div>
        <div className="relative flex justify-center text-xs text-zinc-500">
          <span className="bg-zinc-50 px-2 dark:bg-zinc-950">{t('common.or')}</span>
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
