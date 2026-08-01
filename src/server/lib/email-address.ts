/**
 * The app's single email-format rule.
 *
 * Deliberately not RFC 5322 — that grammar is far wider than anything worth
 * matching, and reachability is proven by the address actually receiving
 * mail. This catches the common abuse and typo shapes (missing `@`, stray
 * whitespace, a bare domain with no dot, control characters, absurd length).
 *
 * It lives here because two entry points now write `users.email`: magic-link
 * login and organization invitations. They previously validated with
 * near-identical but *divergent* regexes — one excluded `.` from the first
 * domain label and capped length at 254, the other did neither — so the two
 * doors into the same column accepted different sets of addresses.
 */
export const MAX_EMAIL_LENGTH = 254;
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
  return (
    typeof email === 'string' &&
    email.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    EMAIL_RE.test(email)
  );
}
