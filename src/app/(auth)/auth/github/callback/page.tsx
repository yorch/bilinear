import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { GITHUB_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';

export const metadata = { title: 'Signing in — Issue Tracker' };

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
