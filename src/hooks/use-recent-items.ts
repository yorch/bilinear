'use client';

import { useCallback, useEffect, useState } from 'react';

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
 * maintain independent recent-item lists.
 * Returns the recent list and a function to record a new visit.
 */
export function useRecentItems(workspaceKey?: string) {
  const key = storageKey(workspaceKey);
  const [items, setItems] = useState<RecentItem[]>(() => loadFromStorage(key));

  // Sync to localStorage whenever items change
  useEffect(() => {
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
