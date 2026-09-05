'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => window.location.origin;
const getServerSnapshot = () => '';

/**
 * The page's origin (`https://app.example.com`), safe to render during SSR.
 *
 * Reading `window.location.origin` behind a `typeof window` check inside a
 * render is a hydration mismatch by construction: the server emits `''`, the
 * client's first render emits the real origin, and React discards the whole
 * tree. `useSyncExternalStore` renders the server snapshot during hydration
 * and re-renders with the real value immediately after, which is the
 * sanctioned way to read a browser-only value on first paint.
 */
export function useOrigin(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
