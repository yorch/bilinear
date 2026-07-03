/**
 * Install a GraphQL auth result as httpOnly session cookies. Shared by every
 * login entry point (magic-link verify, OAuth callbacks) so the
 * `/api/auth/session` contract lives in one place.
 *
 * Returns whether the cookie install succeeded.
 */
export async function installSessionCookies(tokens: {
  accessToken: string;
  refreshToken: string;
}): Promise<boolean> {
  const res = await fetch('/api/auth/session', {
    body: JSON.stringify(tokens),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return res.ok;
}
