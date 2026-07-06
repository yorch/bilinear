'use client';

import { useEffect } from 'react';
import { APP_NAME } from '@/lib/app-config';

/**
 * Sets the browser tab title for the current route. Every workspace page is
 * a client component driven by MobX stores (no per-route server data
 * fetching exists in this app), so titles are synced client-side rather
 * than via `generateMetadata` — before this, every workspace tab read the
 * same static root title regardless of which issue/project/team was open.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) {
      return;
    }
    const previous = document.title;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
