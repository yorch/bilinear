export interface AuthProviderAvailability {
  github: boolean;
  google: boolean;
}

/**
 * Which social sign-in providers this deployment has credentials for. The login
 * page renders a button only for a provider that can complete a round trip — a
 * button for an unconfigured one just produces a server error on click.
 * Both halves of the credential pair are required: the start step only needs
 * the id, but the code exchange fails without the secret.
 */
export function getAuthProviderAvailability(
  env: Record<string, string | undefined> = process.env,
): AuthProviderAvailability {
  const has = (key: string) => Boolean(env[key]?.trim());
  return {
    github: has('GITHUB_CLIENT_ID') && has('GITHUB_CLIENT_SECRET'),
    google: has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET'),
  };
}
