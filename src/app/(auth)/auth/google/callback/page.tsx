import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { GOOGLE_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';

export async function generateMetadata() {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t('meta.signingIn')} — ${appName}` };
}

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
