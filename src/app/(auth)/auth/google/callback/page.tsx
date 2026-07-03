import { Suspense } from 'react';
import { GoogleCallbackHandler } from '@/components/auth/google-callback-handler';

export const metadata = { title: 'Signing in — Issue Tracker' };

export default function GoogleCallbackPage() {
  return (
    <Suspense>
      <GoogleCallbackHandler />
    </Suspense>
  );
}
