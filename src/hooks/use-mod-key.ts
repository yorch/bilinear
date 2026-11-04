'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * The modifier key as this platform labels it: `⌘` on Apple devices, `Ctrl`
 * elsewhere. The bindings accept both (`meta+k` / `ctrl+k`), so only the hint
 * text differs. Server snapshot is `Ctrl`; React reconciles after hydration.
 */
export function useModKey(): '⌘' | 'Ctrl' {
  return useSyncExternalStore(
    subscribe,
    () => (isApplePlatform() ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}
