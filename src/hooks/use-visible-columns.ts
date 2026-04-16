'use client';

import { useCallback, useEffect, useState } from 'react';

/** Fixed issue-row columns that can be hidden. */
export type BuiltInColumn =
  | 'labels'
  | 'dueDate'
  | 'assignee'
  | 'cycle'
  | 'estimate';

/**
 * ColumnKey is a BuiltInColumn or `custom:<definitionId>`. Using a prefixed
 * string lets us persist a single `string[]` in localStorage without a second
 * schema version for custom-field columns.
 */
export type ColumnKey = BuiltInColumn | `custom:${string}`;

const DEFAULT_BUILT_INS: BuiltInColumn[] = [
  'labels',
  'dueDate',
  'assignee',
  'cycle',
  'estimate',
];

const STORAGE_PREFIX = 'issue-tracker:visibleColumns:v1:';

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

  // Re-read when the scope changes (team switch).
  useEffect(() => {
    const stored = readInitial(scope);
    setVisible(new Set<ColumnKey>(stored ?? DEFAULT_BUILT_INS));
  }, [scope]);

  const persist = useCallback(
    (next: Set<ColumnKey>) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(
          storageKey(scope),
          JSON.stringify(Array.from(next)),
        );
      } catch {
        // Storage may be full or disabled — the in-memory state still wins.
      }
    },
    [scope],
  );

  const toggle = useCallback(
    (key: ColumnKey) => {
      setVisible(prev => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const showAll = useCallback(
    (keys: ColumnKey[]) => {
      setVisible(prev => {
        const next = new Set(prev);
        for (const k of keys) {
          next.add(k);
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const isVisible = useCallback(
    (key: ColumnKey) => visible.has(key),
    [visible],
  );

  return { isVisible, showAll, toggle, visible };
}
