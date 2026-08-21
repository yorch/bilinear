import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { GITHUB_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';

export async function generateMetadata() {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t('meta.signingIn')} — ${appName}` };
}

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
