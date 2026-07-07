'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { installSessionCookies } from '@/lib/auth-session';
import { gql } from '@/lib/graphql';
import { EMAIL_VERIFY_MUTATION } from '@/lib/graphql-queries';

export function VerifyCodeForm() {
  const router = useRouter();
  const t = useTranslations();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const prefillCode = searchParams.get('code') ?? '';

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

      router.push('/');
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
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.weSentCodeTo')} <span className="font-medium text-foreground">{email}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="code">
          {t('auth.verificationCode')}
        </label>
        <input
          className="rounded-md border border-border bg-card px-3 py-2 text-center text-2xl font-mono tracking-[0.5em] text-foreground placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:placeholder:text-zinc-700 dark:focus:ring-zinc-100"
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
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <Button className="w-full" disabled={loading || code.length < 6} type="submit">
        {loading ? t('auth.verifying') : t('auth.verifyCode')}
      </Button>

      <button
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={() => router.push(`/login`)}
        type="button"
      >
        {t('auth.useDifferentEmail')}
      </button>
    </form>
  );
}
