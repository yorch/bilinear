import type { Metadata } from 'next';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';

/**
 * Server-only: the `<title>` for a page, localized and branded.
 *
 * Every page that sets a title needs the same two server-resolved values, and
 * the pair was written out verbatim in nine places once the product name became
 * configurable. One knob produced nine copies of its own resolve; a second
 * server-resolved value would have produced nine more. This is where that value
 * gets added instead.
 *
 * Lives in `src/lib` beside `collab-server.ts` and `accent-server.ts`, which
 * are the same shape — thin server helpers the App Router calls directly.
 *
 * The separator is a parameter because the two families genuinely differ: auth
 * screens read "Sign in — Bilinear", while workspace pages match the format
 * `useDocumentTitle` produces client-side, "Inbox · Bilinear". Passing the
 * wrong one is a visible inconsistency, so it is spelled at the call site.
 */
export async function titleMetadata(
  titleKey: string,
  separator: '·' | '—' = '—',
): Promise<Metadata> {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t(titleKey)} ${separator} ${appName}` };
}
