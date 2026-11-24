export interface IntegrationAvailability {
  githubConfigured: boolean;
  slackConfigured: boolean;
}

/**
 * Which workspace integrations this deployment has OAuth credentials for.
 * Both halves of the pair are required: the start step only needs the client
 * id, but the code exchange fails without the secret — so a half-configured
 * server must read as "not configured" rather than send the admin through a
 * consent screen that cannot complete.
 */
export function getIntegrationAvailability(
  env: Record<string, string | undefined> = process.env,
): IntegrationAvailability {
  const has = (key: string) => Boolean(env[key]?.trim());
  return {
    githubConfigured: has('GITHUB_CLIENT_ID') && has('GITHUB_CLIENT_SECRET'),
    slackConfigured: has('SLACK_CLIENT_ID') && has('SLACK_CLIENT_SECRET'),
  };
}
