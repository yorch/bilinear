import { APP_NAME } from '@/lib/app-config';
import { config } from '@/server/config';
import { childLogger } from '@/server/lib/logger';

const log = childLogger({ module: 'branding' });

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
 * The `DATABASE_URL` check is not redundant with the `catch`. `next build`
 * probes every route without secrets or a database (the same contract
 * `env.ts` and `prisma.ts` are written to), and every probe would otherwise
 * log a stack trace for a condition that is expected and correct — burying any
 * real warning in the build output. Absent a database there is no configured
 * value to find, so this returns the answer directly instead of failing to
 * look it up.
 *
 * Cheap to call repeatedly: `ConfigService` memoises the platform scope for its
 * TTL, so the layout, the manifest route and an email send in the same window
 * share one query.
 */
export async function getAppName(): Promise<string> {
  if (!process.env.DATABASE_URL) {
    return APP_NAME;
  }
  try {
    return await config.get<string>('branding.appName');
  } catch (err) {
    log.warn({ err }, 'Could not resolve branding.appName — using the build-time name');
    return APP_NAME;
  }
}
