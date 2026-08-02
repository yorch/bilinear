'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslations } from '@/hooks/use-translations';
import { installSessionCookies } from '@/lib/auth-session';
import { gql } from '@/lib/graphql';
import { EMAIL_VERIFY_MUTATION } from '@/lib/graphql-queries';
import { safeRelativePath } from '@/lib/safe-path';

export function VerifyCodeForm() {
  const router = useRouter();
  const t = useTranslations();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const prefillCode = searchParams.get('code') ?? '';
  // Present when the sign-in was started from a link that needs a session
  // (an invitation). Absent for a magic link opened in a fresh tab, which
  // falls back to the root redirect.
  const next = safeRelativePath(searchParams.get('next')) ?? '/';

  const [code, setCode] = useState(prefillCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

    try {
      const data = await gql(EMAIL_VERIFY_MUTATION, {
        input: { code: verifyCode, email },
      });

      if (data.errors?.length) {
        const err = data.errors[0] as {
          message: string;
          extensions?: { code: string };
        };
        setError(err.extensions?.code === 'INVALID_CODE' ? t('auth.invalidCode') : err.message);
        return;
      }

      const { accessToken, refreshToken } = (
        data.data as {
          emailVerify: { accessToken: string; refreshToken: string };
        }
      ).emailVerify;

      // Store tokens in httpOnly cookies via the session API
      await installSessionCookies({ accessToken, refreshToken });

      router.push(next);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
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
      {email && (
        <p className="text-sm text-muted-foreground">
          {t('auth.weSentCodeTo')} <span className="font-medium text-foreground">{email}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground-secondary" htmlFor="code">
          {t('auth.verificationCode')}
        </label>
        <Input
          // The code is six digits read off a screen and typed back, so it
          // gets the mono face, tabular figures and wide tracking — the one
          // input in the app where character-by-character legibility beats
          // compactness.
          autoComplete="one-time-code"
          className="py-2 text-center font-mono text-2xl tracking-[0.4em] tabular-nums placeholder:text-muted-foreground"
          id="code"
          inputMode="numeric"
          maxLength={6}
          onChange={e => handleCodeChange(e.target.value)}
          pattern="\d{6}"
          placeholder="000000"
          ref={inputRef}
          type="text"
          value={code}
        />
      </div>

      {error && (
        <p className="text-sm text-danger-subtle-foreground" role="alert">
          {error}
        </p>
      )}

      <Button className="w-full" disabled={loading || code.length < 6} type="submit">
        {loading ? t('auth.verifying') : t('auth.verifyCode')}
      </Button>

      <Button onClick={() => router.push('/login')} type="button" variant="link">
        {t('auth.useDifferentEmail')}
      </Button>
    </form>
  );
}
