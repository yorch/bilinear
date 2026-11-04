import { gql } from '@/lib/graphql';
import { GITHUB_AUTH_START_QUERY, GOOGLE_AUTH_START_QUERY } from '@/lib/graphql-queries';
import { gqlError } from '@/lib/utils';

/** Everything needed to start (and later complete) one OAuth provider. */
export interface OAuthStartConfig {
  exchangeField: string;
  label: string;
  startField: string;
  startQuery: string;
  storageKey: string;
}

export const GOOGLE_OAUTH: OAuthStartConfig = {
  exchangeField: 'googleAuthExchange',
  label: 'Google',
  startField: 'googleAuthStart',
  startQuery: GOOGLE_AUTH_START_QUERY,
  storageKey: 'google_oauth_state',
};

export const GITHUB_OAUTH: OAuthStartConfig = {
  exchangeField: 'githubAuthExchange',
  label: 'GitHub',
  startField: 'githubAuthStart',
  startQuery: GITHUB_AUTH_START_QUERY,
  storageKey: 'github_oauth_state',
};

/**
 * Let the server own the OAuth URL (redirect_uri and CSRF state), persist the
 * state for the callback page to replay, then navigate to the provider.
 * Shared by the sign-in form and the callback's "try again" so the start half
 * lives in one place. Resolves with an error message only when it did NOT
 * navigate; on success the page is on its way out.
 */
export async function beginOAuth(
  provider: OAuthStartConfig,
  failureMessage: string,
): Promise<string | null> {
  const result = await gql(provider.startQuery);
  const payload = (result.data as Record<string, { url: string; state: string } | undefined>)?.[
    provider.startField
  ];
  if (!payload) {
    return gqlError(result, failureMessage);
  }
  sessionStorage.setItem(provider.storageKey, payload.state);
  window.location.href = payload.url;
  return null;
}
