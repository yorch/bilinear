import { Suspense } from 'react';
import { OAuthCallbackHandler } from '@/components/auth/oauth-callback-handler';
import { APP_NAME } from '@/lib/app-config';
import { GOOGLE_AUTH_EXCHANGE_MUTATION } from '@/lib/graphql-queries';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.signingIn')} — ${APP_NAME}` };
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
