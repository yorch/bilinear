'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { gql } from '@/lib/graphql';

const EMAIL_VERIFY_MUTATION = `
  mutation EmailVerify($input: EmailVerifyInput!) {
    emailVerify(input: $input) {
      success
      accessToken
      refreshToken
      expiresIn
      user {
        id
        displayName
        email
      }
    }
  }
`;

export function VerifyCodeForm() {
  const router = useRouter();
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
        setError(
          err.extensions?.code === 'INVALID_CODE'
            ? 'Invalid or expired code. Please try again.'
            : err.message,
        );
        return;
      }

      const { accessToken, refreshToken } = (
        data.data as {
          emailVerify: { accessToken: string; refreshToken: string };
        }
      ).emailVerify;

      // Store tokens in cookies via server action / API
      await fetch('/api/auth/session', {
        body: JSON.stringify({ accessToken, refreshToken }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      router.push('/');
    } catch {
      setError('Something went wrong. Please try again.');
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
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          We sent a code to{' '}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{email}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="code">
          Verification code
        </label>
        <input
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-center text-2xl font-mono tracking-[0.5em] text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-700 dark:focus:ring-zinc-100"
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
        {loading ? 'Verifying…' : 'Verify code'}
      </Button>

      <button
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        onClick={() => router.push(`/login`)}
        type="button"
      >
        Use a different email
      </button>
    </form>
  );
}
