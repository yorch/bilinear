import { Suspense } from 'react';
import { GithubCallbackHandler } from '@/components/auth/github-callback-handler';

export const metadata = { title: 'Signing in — Issue Tracker' };

export default function GithubCallbackPage() {
  return (
    <Suspense>
      <GithubCallbackHandler />
    </Suspense>
  );
}
