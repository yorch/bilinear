'use client';

import { type RefObject, useEffect, useRef } from 'react';

/**
 * Return focus to the trigger when a popover closes — but only when focus
 * actually died with the popover's unmount (which drops it on <body>), so
 * outside clicks don't have their focus stolen. Shared by SelectPopover and
 * SearchableSelectPopover; each still owns where focus goes on open.
 */
export function useRestoreFocus(open: boolean, triggerRef: RefObject<HTMLElement | null>) {
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (document.activeElement === document.body) {
        triggerRef.current?.focus();
      }
    }
  }, [open, triggerRef]);
}
