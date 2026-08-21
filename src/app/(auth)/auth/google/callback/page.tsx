import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { GOOGLE_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { titleMetadata } from '@/lib/page-metadata';

export const generateMetadata = () => titleMetadata('meta.signingIn');

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
