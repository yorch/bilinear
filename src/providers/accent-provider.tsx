'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ACCENT_COOKIE, ACCENT_COOKIE_MAX_AGE, type Accent } from '@/lib/accent';

interface AccentContextValue {
  accent: Accent;
  setAccent: (accent: Accent) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({
  children,
  initialAccent,
}: {
  children: React.ReactNode;
  initialAccent: Accent;
}) {
  const [accent, setAccentState] = useState<Accent>(initialAccent);

  // The root layout already stamped `data-accent` server-side, so this only
  // has work to do after a user switch. Keeping it in an effect (rather than
  // writing the attribute inside setAccent) means the DOM stays in sync even
  // if the state is ever changed from somewhere other than setAccent.
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    // Unlike the locale, the accent has no server-side consumer — nothing is
    // rendered off the user's account for it — so the cookie is the whole
    // persistence story. Promoting it to a `User` column would only buy
    // cross-device carry-over, and would cost a migration.
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API isn't broadly supported yet; this is a simple, long-lived preference cookie
    document.cookie = `${ACCENT_COOKIE}=${next}; path=/; max-age=${ACCENT_COOKIE_MAX_AGE}; samesite=lax`;
  }, []);

  return <AccentContext.Provider value={{ accent, setAccent }}>{children}</AccentContext.Provider>;
}

export function useAccent() {
  const ctx = useContext(AccentContext);
  if (!ctx) {
    throw new Error('useAccent must be used within an AccentProvider');
  }
  return ctx;
}
