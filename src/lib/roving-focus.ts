/** The four keys a roving-focus listbox or menu responds to. */
export type RovingFocusKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function isRovingFocusKey(key: string): key is RovingFocusKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

/**
 * Next focused index for a roving-focus list. Arrow keys wrap at both ends —
 * Down from the last item returns to the first, Up from the first (or from "no
 * item focused", where `indexOf` gives -1) lands on the last.
 *
 * Extracted because `SelectPopover` and `SimpleSelect` carried this cascade
 * character-for-character. What legitimately differs between them is which
 * elements count as items and what else the handler guards, so those stay at
 * the call site; only the index arithmetic is shared.
 */
export function nextRovingIndex(key: RovingFocusKey, current: number, length: number): number {
  if (key === 'ArrowDown') {
    return (current + 1) % length;
  }
  if (key === 'ArrowUp') {
    return current <= 0 ? length - 1 : current - 1;
  }
  return key === 'Home' ? 0 : length - 1;
}
