/**
 * Typed, validated accessors for server-only environment variables with a
 * safe default (ports, `APP_URL`, security feature-flag booleans, and the
 * HTTP access-log sample rate).
 *
 * Import-time safety contract (see `prisma.ts`'s lazy Proxy and `jwt.ts`'s
 * lazy `getSecret()` for the established pattern): `next build` imports
 * server modules without real secrets or a live DB, so nothing in this file
 * may throw for a MISSING value. A numeric value is only rejected when it is
 * PRESENT but malformed/out-of-range — that's the actual bug this module
 * fixes (`Number(process.env.WS_PORT ?? 3001)` silently producing `NaN` on
 * a typo, which used to surface as a confusing runtime crash far from the
 * misconfigured value instead of a clear error at boot).
 *
 * Required secrets/connection strings (`JWT_SECRET`, `JWT_REFRESH_SECRET`,
 * `DATABASE_URL`, `REDIS_URL`, …) are deliberately NOT covered here — they
 * have no safe default, and adding an eager throw for them would break the
 * build-without-secrets contract. Keep reading those directly at the point
 * of use (lazily), matching `jwt.ts`'s `getSecret()`.
 */

/**
 * Read a numeric env var, falling back to `default` when unset or empty.
 * Throws a clear error when the value is present but not a finite number,
 * or falls outside `[min, max]` — this is what turns a silent `NaN` (which
 * previously only surfaced later, as a runtime crash when the value was
 * used) into an immediate, actionable boot-time failure.
 *
 * Exported (not just used internally) so `env.test.ts` can exercise the
 * validation logic directly; the loader's public surface is still the
 * frozen `env` object below.
 */
export function numericEnv(
  name: string,
  opts: { default: number; min: number; max: number },
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return opts.default;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) {
    throw new Error(
      `Invalid ${name}: "${raw}" — expected a number between ${opts.min} and ${opts.max}`,
    );
  }
  return n;
}

/**
 * Read a boolean feature-flag env var. Each flag's truthiness test mirrors
 * its pre-existing convention exactly (verified against every call site
 * before consolidating here) — currently all of them use `=== '1'`.
 */
export function boolEnv(name: string): boolean {
  return process.env[name] === '1';
}

/** Default app URL used across dev/test when `APP_URL` is not configured. */
const DEFAULT_APP_URL = 'http://localhost:3000';

/**
 * Fraction of successful, fast HTTP requests to log (0..1). Preserves the
 * exact prior semantics from `src/app/api/graphql/route.ts`: unset/empty
 * means "log everything" (1), and a present-but-unparseable value falls back
 * to 1 rather than throwing (this one field intentionally does NOT use
 * `numericEnv`'s throw-on-invalid behavior, since its original call site
 * never threw either — only clamped).
 */
function sampleRateEnv(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return 1;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/**
 * Typed, validated server environment config. Each property is a *getter*
 * (re-reads `process.env` on every access) rather than a value snapshotted
 * once at import time:
 *
 * - It preserves the exact prior semantics of every call site this replaces
 *   — every one of them read `process.env` fresh at call time (some, like
 *   `email.ts`'s `createTransport()`, are called repeatedly), never cached
 *   at module load.
 * - It keeps existing tests that flip an env var mid-suite (e.g.
 *   `webhook.service.test.ts` setting/deleting `ALLOW_PRIVATE_WEBHOOK_URLS`
 *   between cases) working unmodified — a one-time frozen snapshot would
 *   only reflect whatever was set the first time this module was imported.
 * - For the standalone entry points that read a port once at startup
 *   (`ws/index.ts`, `yjs/index.ts`), the getter still runs — and still
 *   throws on a malformed-but-present value — at the moment they access
 *   `env.WS_PORT`/`env.YJS_PORT`, which is effectively "at boot" for those
 *   processes.
 *
 * Server-only — this module reads raw `process.env` freely and must never be
 * imported from client bundles. Deliberately excludes `NEXT_PUBLIC_*` vars
 * (a different, build-time trust boundary) and required secrets/connection
 * strings (no safe default — see the file-level doc comment).
 */
export const env = Object.freeze({
  /** Escape hatch allowing webhook URLs that resolve to private/loopback IPs (local dev only). */
  get ALLOW_PRIVATE_WEBHOOK_URLS(): boolean {
    return boolEnv('ALLOW_PRIVATE_WEBHOOK_URLS');
  },
  /** Base app URL, e.g. for building absolute links in emails/redirects. */
  get APP_URL(): string {
    return process.env.APP_URL ?? DEFAULT_APP_URL;
  },

  /** Fail-closed the auth-mutation rate limiter on a Redis outage. */
  get AUTH_RATE_LIMIT_FAIL_CLOSED(): boolean {
    return boolEnv('AUTH_RATE_LIMIT_FAIL_CLOSED');
  },

  /** Fraction of successful, fast requests to emit an access log for. */
  get LOG_HTTP_SAMPLE_RATE(): number {
    return sampleRateEnv('LOG_HTTP_SAMPLE_RATE');
  },

  /** SMTP transport port. */
  get SMTP_PORT(): number {
    return numericEnv('SMTP_PORT', { default: 587, max: 65535, min: 1 });
  },

  /** Trust `X-Forwarded-For`/`X-Real-IP` (only behind a proxy that strips client-supplied ones). */
  get TRUST_PROXY_HEADERS(): boolean {
    return boolEnv('TRUST_PROXY_HEADERS');
  },

  /** Standalone WebSocket server port (`yarn ws:server`). */
  get WS_PORT(): number {
    return numericEnv('WS_PORT', { default: 3001, max: 65535, min: 1 });
  },

  /** Standalone YJS collaborative-editing server port (`yarn yjs:server`). */
  get YJS_PORT(): number {
    return numericEnv('YJS_PORT', { default: 1234, max: 65535, min: 1 });
  },
});
