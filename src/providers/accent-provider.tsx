'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ACCENT_COOKIE, ACCENT_COOKIE_MAX_AGE, type Accent } from '@/lib/accent';
import { gql } from '@/lib/graphql';
import { USER_UPDATE_ACCENT_MUTATION } from '@/lib/graphql-queries';

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
    // The cookie is what the running app reads — the root layout stamps it
    // onto <html> during SSR, so this is what makes the change survive a
    // reload with no flash.
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API isn't broadly supported yet; this is a simple, long-lived preference cookie
    document.cookie = `${ACCENT_COOKIE}=${next}; path=/; max-age=${ACCENT_COOKIE_MAX_AGE}; samesite=lax`;

    // Persist to the account as well, so the preference follows the user to a
    // new browser or device (the session route seeds the cookie from it at
    // login). Fire-and-forget, and deliberately quiet about UNAUTHENTICATED:
    // the accent is switchable from the pre-login pages too, where there is no
    // account to write to yet. Any other failure is logged, since a silently
    // unsaved preference is otherwise invisible.
    void gql(USER_UPDATE_ACCENT_MUTATION, { accent: next })
      .then(res => {
        const errors = res?.errors;
        if (!errors?.length) {
          return;
        }
        const onlyUnauthenticated = errors.every(
          err =>
            (err as { extensions?: { code?: string } })?.extensions?.code === 'UNAUTHENTICATED',
        );
        if (!onlyUnauthenticated) {
          console.warn('Failed to persist accent preference', errors);
        }
      })
      .catch(err => console.warn('Failed to persist accent preference', err));
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
