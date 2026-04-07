'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const EMAIL_LOGIN_MUTATION = `
  mutation EmailLogin($input: EmailLoginInput!) {
    emailLogin(input: $input) {
      success
    }
  }
`;

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: EMAIL_LOGIN_MUTATION,
          variables: { input: { email } },
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      const data = await res.json();

      if (data.errors?.length) {
        setError(data.errors[0].message);
        return;
      }

      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-100"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="w-full"
        data-testid="email-submit"
      >
        {loading ? 'Sending…' : 'Continue with email'}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
        </div>
        <div className="relative flex justify-center text-xs text-zinc-500">
          <span className="bg-zinc-50 px-2 dark:bg-zinc-950">or</span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => {
          const params = new URLSearchParams({
            access_type: 'offline',
            client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
            prompt: 'consent',
            redirect_uri: `${window.location.origin}/auth/google/callback`,
            response_type: 'code',
            scope: 'openid email profile',
          });
          window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
        }}
      >
        Continue with Google
      </Button>
    </form>
  );
}
