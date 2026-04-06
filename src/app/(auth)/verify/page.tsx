import { Suspense } from 'react';
import { VerifyCodeForm } from '@/components/auth/verify-code-form';

export const metadata = { title: 'Verify — Issue Tracker' };

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Check your email
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter the 6-digit code we sent you
        </p>
      </div>
      <Suspense>
        <VerifyCodeForm />
      </Suspense>
    </div>
  );
}
