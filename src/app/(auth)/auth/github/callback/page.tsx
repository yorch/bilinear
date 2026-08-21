import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { GITHUB_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { titleMetadata } from '@/lib/page-metadata';

export const generateMetadata = () => titleMetadata('meta.signingIn');

export default function GithubCallbackPage() {
  return (
    <Suspense>
      <OAuthCallbackHandler
        provider={{
          exchangeField: 'githubAuthExchange',
          label: 'GitHub',
          mutation: GITHUB_AUTH_EXCHANGE_MUTATION,
          storageKey: 'github_oauth_state',
        }}
      />
    </Suspense>
  );
}
