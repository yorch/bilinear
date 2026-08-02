'use client';

import { createContext, useContext } from 'react';
import { type CollabConfig, DISABLED_COLLAB_CONFIG } from '@/lib/collab';

/**
 * Carries the server-resolved collaborative-editing config down to the editor.
 *
 * `HocuspocusProvider` is constructed synchronously during render and needs
 * its `url` right then, so the value cannot be fetched — it has to already be
 * in the tree. That is the same constraint the accent has (it must be correct
 * on first paint), and this follows the same shape: the root layout, a server
 * component, resolves it and passes it to a client provider.
 *
 * Unlike `useAccent`, a missing provider is NOT an error — it falls back to
 * "collab disabled", so an editor rendered outside the tree renders as a plain
 * one instead of throwing.
 */
const CollabContext = createContext<CollabConfig>(DISABLED_COLLAB_CONFIG);

export function CollabProvider({
  children,
  config,
}: {
  children: React.ReactNode;
  config: CollabConfig;
}) {
  return <CollabContext.Provider value={config}>{children}</CollabContext.Provider>;
}

export function useCollabConfig(): CollabConfig {
  return useContext(CollabContext);
}
