'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Fixed issue-row columns that can be hidden. */
export type BuiltInColumn = 'labels' | 'dueDate' | 'assignee' | 'cycle' | 'estimate';

/**
 * ColumnKey is a BuiltInColumn or `custom:<definitionId>`. Using a prefixed
 * string lets us persist a single `string[]` in localStorage without a second
 * schema version for custom-field columns.
 */
export type ColumnKey = BuiltInColumn | `custom:${string}`;

const DEFAULT_BUILT_INS: BuiltInColumn[] = ['labels', 'dueDate', 'assignee', 'cycle', 'estimate'];

const STORAGE_PREFIX = 'bilinear:visibleColumns:v1:';

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

function readInitial(scope: string): ColumnKey[] | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string')) {
      return null;
    }
    return parsed as ColumnKey[];
  } catch {
    return null;
  }
}

/**
 * Per-scope (typically per-team) set of visible issue-row columns, backed by
 * localStorage. Returns the current set plus a toggle helper.
 *
 * Unknown keys from storage are kept as-is so a custom-field column added
 * elsewhere survives a page reload even if this component doesn't know about
 * it yet; the consumer is responsible for filtering out keys whose backing
 * definition was archived.
 */
export function useVisibleColumns(scope: string): {
  visible: Set<ColumnKey>;
  isVisible: (key: ColumnKey) => boolean;
  toggle: (key: ColumnKey) => void;
  showAll: (keys: ColumnKey[]) => void;
} {
  const [visible, setVisible] = useState<Set<ColumnKey>>(() => {
    const stored = readInitial(scope);
    return new Set<ColumnKey>(stored ?? DEFAULT_BUILT_INS);
  });

  // Suppresses the persist effect for a `visible` value that came *from*
  // storage rather than from a user action — the initial mount and every scope
  // change. Without it the hook would write the defaults back out for a scope
  // nobody has customised yet, inventing a stored preference from a read.
  const skipPersistRef = useRef(true);

  // Re-read when the scope changes (team switch).
  useEffect(() => {
    const stored = readInitial(scope);
    skipPersistRef.current = true;
    setVisible(new Set<ColumnKey>(stored ?? DEFAULT_BUILT_INS));
  }, [scope]);

  const persist = useCallback(
    (next: Set<ColumnKey>) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(storageKey(scope), JSON.stringify(Array.from(next)));
      } catch {
        // Storage may be full or disabled — the in-memory state still wins.
      }
    },
    [scope],
  );

  // Both updaters stay *functional* — deriving the next Set from the render
  // closure's `visible` instead loses an update whenever two calls land in one
  // React batch (`showAll(...)` then `toggle(...)` from the same handler), since
  // both would build from the same pre-batch value and the last write would win.
  // The localStorage write therefore cannot live inside the updater — React may
  // invoke one more than once — so it runs in the effect below, off `visible`.
  const toggle = useCallback((key: ColumnKey) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const showAll = useCallback((keys: ColumnKey[]) => {
    setVisible(prev => {
      const next = new Set(prev);
      for (const k of keys) {
        next.add(k);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    persist(visible);
  }, [visible, persist]);

  const isVisible = useCallback((key: ColumnKey) => visible.has(key), [visible]);

  return { isVisible, showAll, toggle, visible };
}
