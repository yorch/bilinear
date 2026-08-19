/**
 * The facts both readers of `process.env` need.
 *
 * There are two: `src/server/lib/env.ts` is the runtime accessor every call
 * site uses, and `src/lib/config/registry.ts` declares the same variables so
 * the admin console can report them. They are separate on purpose — `env.ts`
 * must be importable before a database connection exists and must not throw at
 * import time, while the registry is imported by client code — but the two have
 * already disagreed once in this repo: the registry parsed `'true'` as true
 * while `boolEnv` accepts only `'1'`, so the console reported the SSRF guard as
 * disabled while the guard was still enforcing.
 *
 * Anything both sides restate lives here, so there is one copy to change rather
 * than a comment asking the next person to remember.
 *
 * This is `src/lib`, not `src/server/lib`, because the registry is client-side
 * and must never import from `src/server/`.
 */

/**
 * The one truthiness test for a boolean environment flag: the literal string
 * `'1'`, and nothing else.
 *
 * Deliberately stricter than it looks like it should be. `'true'` is *not*
 * accepted, and widening it is the unsafe direction: the flags this governs
 * include `ALLOW_PRIVATE_WEBHOOK_URLS` (the SSRF guard) and
 * `AUTH_RATE_LIMIT_FAIL_CLOSED`, so accepting `'true'` would silently turn the
 * SSRF guard off for every deployment that had written `=true` while it was in
 * fact off.
 */
export function isEnvFlagSet(raw: string | undefined): boolean {
  return raw === '1';
}

/**
 * Fallbacks the code applies when a variable is unset.
 *
 * The registry needs these so the console can report what the process is
 * *actually* doing: with a blanket `''` it showed `env.SMTP_PORT` as empty
 * while mail was going out on 587 — a configuration console stating a fact
 * that was not true.
 */
export const ENV_DEFAULTS = {
  APP_URL: 'http://localhost:3000',
  SMTP_PORT: 587,
  WS_PORT: 3001,
  YJS_PORT: 1234,
} as const;
