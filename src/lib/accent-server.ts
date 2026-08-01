import { cookies } from 'next/headers';
import { ACCENT_COOKIE, type Accent, defaultAccent, isAccent } from './accent';

/**
 * Server-only: resolve the active accent from the `accent` cookie so the root
 * layout can stamp `data-accent` on `<html>` before first paint.
 *
 * Unlike the locale there is no `Accept-*` header to negotiate against, so an
 * unset or unrecognised cookie simply falls back to the default accent.
 */
export async function getServerAccent(): Promise<Accent> {
  const cookieAccent = (await cookies()).get(ACCENT_COOKIE)?.value;
  return isAccent(cookieAccent) ? cookieAccent : defaultAccent;
}
