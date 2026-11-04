'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AuthField } from '@/components/auth/auth-field';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { installSessionCookies } from '@/lib/auth-session';
import { GqlError, gql, gqlQuery, isGqlErrorCode } from '@/lib/graphql';
import { EMAIL_LOGIN_MUTATION, EMAIL_VERIFY_MUTATION } from '@/lib/graphql-queries';
import { safeRelativePath } from '@/lib/safe-path';

/** Seconds before "Resend code" unlocks — the first code was just sent. */
const RESEND_COOLDOWN_SECONDS = 30;

export function VerifyCodeForm() {
  const router = useRouter();
  const t = useTranslations();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const prefillCode = searchParams.get('code') ?? '';
  // Present when the sign-in was started from a link that needs a session
  // (an invitation). Absent for a magic link opened in a fresh tab, which
  // falls back to the root redirect.
  const nextParam = safeRelativePath(searchParams.get('next'));
  const next = nextParam ?? '/';

  const [code, setCode] = useState(prefillCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // After a rejected code, leave the digits selected so the next keystroke or
  // paste replaces them instead of the user clearing six characters by hand.
  useEffect(() => {
    if (error) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [error]);

  // Auto-submit if code prefilled via URL (intentionally only runs once on mount)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    if (prefillCode.length === 6) {
      handleVerify(prefillCode);
    }
  }, []);

  async function handleVerify(verifyCode: string) {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const { accessToken, refreshToken } = await gqlQuery<{
        accessToken: string;
        refreshToken: string;
      }>(EMAIL_VERIFY_MUTATION, { input: { code: verifyCode, email } }, 'emailVerify');

      // Store tokens in httpOnly cookies via the session API
      await installSessionCookies({ accessToken, refreshToken });

      router.push(next);
    } catch (err) {
      // A wrong/expired code is the expected failure and gets its own copy;
      // any other rejected request shows the server's message. A transport
      // failure (or a throw from installSessionCookies) has no message worth
      // showing, so it keeps the generic fallback.
      if (isGqlErrorCode(err, 'INVALID_CODE')) {
        setError(t('auth.invalidCode'));
      } else {
        setError(err instanceof GqlError ? err.message : t('common.somethingWentWrong'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const data = await gql(EMAIL_LOGIN_MUTATION, { input: { email } });
      if (data.errors?.length) {
        setError((data.errors[0] as { message: string }).message);
        return;
      }
      setNotice(t('auth.codeResent'));
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      inputRef.current?.focus();
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setResending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length === 6) {
      handleVerify(code);
    }
  }

  function handleCodeChange(value: string) {
    const cleaned = value.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) {
      handleVerify(cleaned);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <AuthField
        // The code is six digits read off a screen and typed back, so it
        // gets the mono face, tabular figures and wide tracking — the one
        // input in the app where character-by-character legibility beats
        // compactness.
        autoComplete="one-time-code"
        className="py-2 text-center font-mono text-2xl tracking-[0.4em] tabular-nums placeholder:text-muted-foreground"
        error={error}
        hint={notice ?? t('auth.codeHint')}
        id="code"
        inputMode="numeric"
        label={t('auth.verificationCode')}
        maxLength={6}
        name="code"
        onChange={e => handleCodeChange(e.target.value)}
        pattern="\d{6}"
        placeholder="000000"
        readOnly={loading}
        ref={inputRef}
        type="text"
        value={code}
      />

      <Button className="w-full" disabled={loading || code.length < 6} type="submit">
        {loading ? t('auth.verifying') : t('auth.verifyCode')}
      </Button>

      <div className="flex flex-col items-center gap-1">
        <Button
          disabled={cooldown > 0 || resending || loading}
          onClick={() => void handleResend()}
          type="button"
          variant="link"
        >
          {cooldown > 0 ? t('auth.resendCodeIn', { seconds: cooldown }) : t('auth.resendCode')}
        </Button>
        <Button asChild variant="link">
          <Link
            href={`/login?email=${encodeURIComponent(email)}${
              nextParam ? `&next=${encodeURIComponent(nextParam)}` : ''
            }`}
          >
            {t('auth.useDifferentEmail')}
          </Link>
        </Button>
      </div>
    </form>
  );
}
