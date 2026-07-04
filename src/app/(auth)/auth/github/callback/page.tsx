import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { APP_NAME } from '@/lib/app-config';
import { GITHUB_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.signingIn')} — ${APP_NAME}` };
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
