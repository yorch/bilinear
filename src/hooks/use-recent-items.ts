'use client';

import { useCallback, useEffect, useState } from 'react';

export interface RecentItem {
  id: string;
  identifier: string;
  title: string;
  teamKey: string;
  visitedAt: number; // ms timestamp
}

const STORAGE_KEY = 'issue-tracker:recent-issues';
const MAX_RECENT = 5;

function loadFromStorage(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(items: RecentItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage errors (private browsing, quota exceeded)
  }
}

/**
 * Tracks the last MAX_RECENT visited issues in localStorage.
 * Returns the recent list and a function to record a new visit.
 */
export function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>(() => loadFromStorage());

  // Sync to localStorage whenever items change
  useEffect(() => {
    saveToStorage(items);
  }, [items]);

  const addRecent = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    setItems(prev => {
      // Remove any existing entry for this issue
      const filtered = prev.filter(i => i.id !== item.id);
      // Prepend new entry and trim to MAX_RECENT
      return [{ ...item, visitedAt: Date.now() }, ...filtered].slice(
        0,
        MAX_RECENT,
      );
    });
  }, []);

  return { addRecent, items };
}
