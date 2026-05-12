'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecentItem {
  id: string;
  identifier: string;
  teamKey: string;
  title: string;
  visitedAt: number; // ms timestamp
}

const MAX_RECENT = 5;

function storageKey(workspaceKey?: string): string {
  return workspaceKey
    ? `issue-tracker:${workspaceKey}:recent-issues`
    : 'issue-tracker:recent-issues';
}

function loadFromStorage(key: string): RecentItem[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(key: string, items: RecentItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage errors (private browsing, quota exceeded)
  }
}

/**
 * Tracks the last MAX_RECENT visited issues in localStorage.
 * Scoped by `workspaceKey` so multiple workspaces on the same origin
 * maintain independent recent-item lists. Re-loads from storage when
 * `workspaceKey` changes — without that, switching workspaces would
 * keep showing the previous workspace's list AND the persist effect
 * would silently overwrite the new workspace's storage with stale
 * items.
 */
export function useRecentItems(workspaceKey?: string) {
  const key = storageKey(workspaceKey);
  const [items, setItems] = useState<RecentItem[]>(() => loadFromStorage(key));

  // Track the key that produced the current `items` state. The persist
  // effect must NOT write `items` into a newly-changed `key` before the
  // load effect has had a chance to swap state to the new workspace's
  // list, or it would corrupt the new workspace's localStorage.
  const loadedKeyRef = useRef(key);

  useEffect(() => {
    if (loadedKeyRef.current === key) {
      return;
    }
    loadedKeyRef.current = key;
    setItems(loadFromStorage(key));
  }, [key]);

  useEffect(() => {
    if (loadedKeyRef.current !== key) {
      // We're between renders — `key` changed but the load effect above
      // hasn't run yet. Skip the write so we don't corrupt the new key
      // with the old workspace's items.
      return;
    }
    saveToStorage(key, items);
  }, [key, items]);

  const addRecent = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    setItems(prev => {
      // Remove any existing entry for this issue
      const filtered = prev.filter(i => i.id !== item.id);
      // Prepend new entry and trim to MAX_RECENT
      return [{ ...item, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    });
  }, []);

  return { addRecent, items };
}
