import { APP_NAME } from '@/lib/app-config';
import { config } from '@/server/config';
import { childLogger } from '@/server/lib/logger';

const log = childLogger({ module: 'branding' });

/** One warning per process, not one per render. See `getAppName`. */
let warned = false;

/**
 * The configured product name, for every server-rendered surface: the root
 * layout (which hands it to `BrandingProvider`), page metadata, the PWA
 * manifest and transactional email.
 *
 * **Never throws.** Branding is the least important thing on a page and among
 * the earliest rendered, so a database blip must degrade the name rather than
 * the response. The build-time constant is the fallback, which is exactly what
 * the app rendered before this knob existed.
 *
 * Two things keep it quiet without keeping it silent:
 *
 * - `NEXT_PHASE` is what Next actually sets while building, so a build's route
 *   probes skip the lookup entirely rather than each opening a connection that
 *   cannot succeed. An earlier version keyed on `DATABASE_URL` being unset,
 *   which reads like the same test and is not: CI sets that variable to an
 *   unreachable host for `yarn build`, so the guard passed, every probe waited
 *   out a connect timeout, and logged the stack trace the guard existed to
 *   prevent. It also failed the other way — a *runtime* deployment missing the
 *   variable got the fallback with no warning at all.
 * - The failure warns once per process. Repeating it per render buries every
 *   other line in the log without adding information.
 *
 * Cheap to call repeatedly: `ConfigService` memoises the platform scope for its
 * TTL, so the layout, the manifest route and an email send in the same window
 * share one query.
 */
export async function getAppName(): Promise<string> {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return APP_NAME;
  }
  try {
    return await config.get<string>('branding.appName');
  } catch (err) {
    if (!warned) {
      warned = true;
      log.warn({ err }, 'Could not resolve branding.appName — using the build-time name');
    }
    return APP_NAME;
  }
}
