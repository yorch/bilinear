'use client';

import { createContext, useContext, useMemo } from 'react';
import { getRootStore, type RootStore } from '@/stores/root-store';

const StoreContext = createContext<RootStore | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => getRootStore(), []);
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

export function useStore(): RootStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return store;
}
