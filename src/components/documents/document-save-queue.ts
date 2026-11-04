/**
 * Debounced, per-field save queue for the document editor.
 *
 * Title and body are independent fields with independent timers. They used to
 * share one timer, so typing in the body within a second of editing the title
 * cancelled the title save (and vice versa) — the edit was silently lost.
 * `flush()` sends whatever is pending immediately and is what the editor calls
 * on unmount, so navigating away inside the debounce window no longer drops
 * the edit.
 */
export type SaveField = 'content' | 'title';
export type SaveStatus = 'error' | 'idle' | 'saved' | 'saving';

export interface SaveCallbacks {
  onError: () => void;
  onSuccess: () => void;
}

interface SaveQueueOptions {
  delayMs?: number;
  onStatus?: (status: SaveStatus) => void;
  /** Hands one field's latest value to the transport (TransactionQueue). */
  send: (field: SaveField, value: string, callbacks: SaveCallbacks) => void;
}

export function createSaveQueue({ delayMs = 1000, onStatus, send }: SaveQueueOptions) {
  const timers: Partial<Record<SaveField, ReturnType<typeof setTimeout>>> = {};
  const values: Partial<Record<SaveField, string>> = {};
  const inFlightByField: Partial<Record<SaveField, number>> = {};
  // Per-field: a later success on another field must not clear a failure, and
  // the value is kept so the edit can be retried instead of silently dropped.
  const failedValues: Partial<Record<SaveField, string>> = {};
  const inFlightTotal = () => (inFlightByField.content ?? 0) + (inFlightByField.title ?? 0);
  let status: SaveStatus = 'idle';

  const setStatus = (next: SaveStatus) => {
    if (next !== status) {
      status = next;
      onStatus?.(next);
    }
  };

  const recompute = () => {
    const pending = Object.keys(timers).length > 0 || inFlightTotal() > 0;
    if (pending) {
      setStatus('saving');
    } else if (Object.keys(failedValues).length > 0) {
      setStatus('error');
    } else if (status !== 'idle') {
      setStatus('saved');
    }
  };

  const dispatch = (field: SaveField) => {
    const value = values[field];
    delete timers[field];
    delete values[field];
    if (value === undefined) {
      return;
    }
    inFlightByField[field] = (inFlightByField[field] ?? 0) + 1;
    delete failedValues[field];
    send(field, value, {
      onError: () => {
        inFlightByField[field] = Math.max(0, (inFlightByField[field] ?? 1) - 1);
        // A newer edit to the same field supersedes the failed one.
        if (timers[field] === undefined && values[field] === undefined) {
          failedValues[field] = value;
        }
        recompute();
      },
      onSuccess: () => {
        inFlightByField[field] = Math.max(0, (inFlightByField[field] ?? 1) - 1);
        recompute();
      },
    });
  };

  return {
    /** Drop pending edits without sending (e.g. the document was deleted). */
    cancel() {
      for (const field of Object.keys(timers) as SaveField[]) {
        clearTimeout(timers[field]);
        delete timers[field];
        delete values[field];
      }
      if (inFlightTotal() === 0 && Object.keys(failedValues).length === 0) {
        // Nothing sent and nothing failed: there is nothing to report.
        setStatus('idle');
      } else {
        recompute();
      }
    },
    /** Send every pending field now. */
    flush() {
      for (const field of Object.keys(timers) as SaveField[]) {
        clearTimeout(timers[field]);
        dispatch(field);
      }
    },
    hasPending(field: SaveField) {
      return timers[field] !== undefined;
    },
    /**
     * True while the field has a local edit the store has not caught up with:
     * waiting on the debounce timer OR already sent and unacknowledged. A store
     * echo of an older save must not overwrite the textarea while this holds.
     */
    isDirty(field: SaveField) {
      return timers[field] !== undefined || (inFlightByField[field] ?? 0) > 0;
    },
    /** Re-send every field whose last save failed. */
    retry() {
      for (const field of Object.keys(failedValues) as SaveField[]) {
        const value = failedValues[field];
        if (value !== undefined && timers[field] === undefined) {
          values[field] = value;
          dispatch(field);
        }
      }
      recompute();
    },
    schedule(field: SaveField, value: string) {
      values[field] = value;
      delete failedValues[field];
      const existing = timers[field];
      if (existing) {
        clearTimeout(existing);
      }
      timers[field] = setTimeout(() => dispatch(field), delayMs);
      setStatus('saving');
    },
  };
}
