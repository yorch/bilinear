'use client';

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

/**
 * A text field that mirrors a stored value without trampling the user.
 *
 * The stored value changes underneath an open editor (another client's edit
 * arriving over sync, or this client's own optimistic write rolling back).
 * Re-seeding on every change wiped whatever the user was typing — the comment
 * said it did not, but the effect ran unconditionally. The rule here: never
 * overwrite while the field has focus or holds typing that has not been
 * committed; once neither is true, follow the stored value again.
 *
 * `finish()` is for `onBlur`: it ends the editing session and returns whether
 * the user actually typed. Commit only when it returns true — an untouched field
 * must not write its stale seed back over a newer remote value (it re-adopts the
 * stored value instead).
 */
export function useSeededField(stored: string) {
  const [value, setValue] = useState(stored);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const focused = useRef(false);
  const typed = useRef(false);

  useEffect(() => {
    if (!focused.current && !typed.current) {
      setValue(stored);
    }
  }, [stored]);

  const onFocus = useCallback(() => {
    focused.current = true;
  }, []);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    typed.current = true;
    setValue(e.target.value);
  }, []);
  const finish = useCallback(() => {
    const didType = typed.current;
    focused.current = false;
    typed.current = false;
    if (!didType) {
      setValue(storedRef.current);
    }
    return didType;
  }, []);
  /** Drop the draft (Escape, or a refused empty value) and show the stored value. */
  const reset = useCallback(() => {
    typed.current = false;
    setValue(storedRef.current);
  }, []);

  return { finish, inputProps: { onChange, onFocus, value }, reset, value };
}
