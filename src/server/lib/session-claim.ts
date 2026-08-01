import { cookies } from 'next/headers';
import type { AccessTokenPayload } from './jwt';
import { verifyAccessToken } from './jwt';

/**
 * Read and verify the session claim in a **server component**.
 *
 * `requireAuthContext` is the equivalent for route handlers, but it takes a
 * `NextRequest` and answers with a `NextResponse`, neither of which a server
 * component has. So this returns the claim or null and leaves the policy to
 * the caller — each page genuinely wants something different from "no valid
 * session": the root page and the workspace guard redirect to `/login`, the
 * admin console redirects too but additionally inspects `impersonatorId`, and
 * the invitation page degrades to "sign in to accept" without redirecting at
 * all.
 *
 * Note this trusts the token's signature and expiry only — it does **not**
 * re-check that the user is active or still a member of `orgId`. Callers that
 * act on `orgId` must verify it (see `UserService.findUsableMembership`);
 * `extractAuthContext` does that for every request that reaches the API.
 */
export async function readSessionClaim(): Promise<AccessTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) {
    return null;
  }
  try {
    return await verifyAccessToken(token);
  } catch {
    // Expired, malformed, or signed with a rotated secret — all "no session".
    return null;
  }
}
