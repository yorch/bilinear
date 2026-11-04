'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AuthField } from '@/components/auth/auth-field';
import {
  beginOAuth,
  GITHUB_OAUTH,
  GOOGLE_OAUTH,
  type OAuthStartConfig,
} from '@/components/auth/oauth-start';
import { GitHubIcon, GoogleIcon } from '@/components/auth/provider-icons';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { EMAIL_LOGIN_MUTATION } from '@/lib/graphql-queries';
import { rememberPostAuthNext, safeRelativePath } from '@/lib/safe-path';

// Deliberately loose: the server is the authority. This only catches the
// obvious typo so we can show a themed, localized message instead of the
// browser's native bubble.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations();
  // Where to land after signing in — set when the user arrived from a link
  // that needs a session (today: an invitation). Validated as an in-app path
  // before it reaches any navigation; see safeRelativePath.
  const searchParams = useSearchParams();
  const next = safeRelativePath(searchParams.get('next'));
  // Prefilled when the user comes back from /verify via "Use a different
  // email", or when a submit fires before hydration and the page reloads.
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [loading, setLoading] = useState(false);
  // The provider whose redirect is in flight; disables every sign-in control
  // so a double click can't mint two state tokens.
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const busy = loading || oauthPending !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) {
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError(t('auth.emailInvalid'));
      setError(null);
      return;
    }
    setEmailError(null);
    setLoading(true);
    setError(null);

    try {
      const data = await gql(EMAIL_LOGIN_MUTATION, { input: { email: email.trim() } });

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
        ? `/verify?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`
        : `/verify?email=${encodeURIComponent(email.trim())}`;
      router.push(verifyUrl);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <AuthField
        autoCapitalize="none"
        autoComplete="email"
        autoFocus
        error={emailError}
        id="email"
        inputMode="email"
        label={t('auth.emailAddress')}
        name="email"
        onChange={e => {
          setEmail(e.target.value);
          setEmailError(null);
        }}
        placeholder={t('auth.emailPlaceholder')}
        required
        spellCheck={false}
        type="email"
        value={email}
      />

      {error && (
        <p className="text-sm text-danger-subtle-foreground" role="alert">
          {error}
        </p>
      )}

      <Button className="w-full" data-testid="email-submit" disabled={busy} type="submit">
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
        disabled={busy}
        onClick={() => startOAuth(GOOGLE_OAUTH)}
        type="button"
        variant="outline"
      >
        <GoogleIcon />
        {t('auth.continueWithGoogle')}
      </Button>

      <Button
        className="w-full"
        disabled={busy}
        onClick={() => startOAuth(GITHUB_OAUTH)}
        type="button"
        variant="outline"
      >
        <GitHubIcon />
        {t('auth.continueWithGitHub')}
      </Button>
    </form>
  );

  async function startOAuth(provider: OAuthStartConfig) {
    setOauthPending(provider.label);
    setError(null);
    try {
      // OAuth returns to a server-controlled redirect URI that carries none
      // of our query params, so the destination has to survive the round
      // trip out-of-band.
      rememberPostAuthNext(next);
      const failure = await beginOAuth(
        provider,
        t('auth.failedToStart', { provider: provider.label }),
      );
      if (failure) {
        setError(failure);
        setOauthPending(null);
      }
    } catch {
      setError(t('common.somethingWentWrong'));
      setOauthPending(null);
    }
  }
}
