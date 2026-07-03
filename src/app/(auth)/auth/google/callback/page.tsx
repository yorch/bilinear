import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { GOOGLE_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';

export const metadata = { title: 'Signing in — Issue Tracker' };

export default function GoogleCallbackPage() {
  return (
    <Suspense>
      <OAuthCallbackHandler
        provider={{
          exchangeField: 'googleAuthExchange',
          label: 'Google',
          mutation: GOOGLE_AUTH_EXCHANGE_MUTATION,
          storageKey: 'google_oauth_state',
        }}
      />
    </Suspense>
  );
}
