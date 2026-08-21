'use client';

import { createContext, useContext } from 'react';
import { APP_NAME } from '@/lib/app-config';

/**
 * Carries the server-resolved product name down to every client component that
 * renders it — the sidebar, the mobile top bar, the auth screens, the document
 * title.
 *
 * Same shape as `CollabProvider`, for the same reason: the value comes from the
 * database but has to be correct on first paint, so the root layout (a server
 * component) resolves it once per request and hands it in rather than every
 * consumer fetching. Nothing here reads `process.env` — `next build` inlines
 * `NEXT_PUBLIC_APP_NAME`, which is exactly the rebuild trap this replaces.
 *
 * A missing provider is not an error. It falls back to the build-time constant,
 * so a component rendered outside the tree (a test, an isolated story) shows
 * the same name it did before the knob existed rather than throwing.
 */
const BrandingContext = createContext<string>(APP_NAME);

export function BrandingProvider({
  appName,
  children,
}: {
  appName: string;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={appName}>{children}</BrandingContext.Provider>;
}

/** The configured product name. Safe to call from any client component. */
export function useAppName(): string {
  return useContext(BrandingContext);
}
