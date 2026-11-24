'use client';

import { useSyncExternalStore } from 'react';
import {
  DEFAULT_NUMBER_FORMAT,
  type NumberFieldFormat,
  parseNumberFormat,
} from '@/lib/custom-field-format';

/**
 * Per-field number display format, kept client-side.
 *
 * The definition's `options` JSON is reserved for select options (the service
 * rejects options on a number field and the GraphQL input is a list of
 * option rows), and a new column would need a migration, so the format lives
 * in localStorage keyed by definition id — a per-viewer display preference,
 * like column visibility. The raw value is never touched.
 */
const KEY_PREFIX = 'customField.format.';
const EVENT = 'custom-field-format-change';

const cache = new Map<string, { raw: string | null; format: NumberFieldFormat }>();

export function getFieldFormat(definitionId: string): NumberFieldFormat {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY_PREFIX + definitionId);
  } catch {
    return DEFAULT_NUMBER_FORMAT;
  }
  const hit = cache.get(definitionId);
  if (hit && hit.raw === raw) {
    return hit.format;
  }
  let format = DEFAULT_NUMBER_FORMAT;
  if (raw) {
    try {
      format = parseNumberFormat(JSON.parse(raw));
    } catch {
      format = DEFAULT_NUMBER_FORMAT;
    }
  }
  cache.set(definitionId, { format, raw });
  return format;
}

export function setFieldFormat(definitionId: string, format: NumberFieldFormat): void {
  try {
    if (format.kind === 'plain' && format.decimals === undefined) {
      window.localStorage.removeItem(KEY_PREFIX + definitionId);
    } else {
      window.localStorage.setItem(KEY_PREFIX + definitionId, JSON.stringify(format));
    }
  } catch {
    // Storage blocked: the format applies for this session only via the event.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Reactive format for one field (plain on the server / first paint). */
export function useFieldFormat(definitionId: string): NumberFieldFormat {
  return useSyncExternalStore(
    subscribe,
    () => getFieldFormat(definitionId),
    () => DEFAULT_NUMBER_FORMAT,
  );
}
