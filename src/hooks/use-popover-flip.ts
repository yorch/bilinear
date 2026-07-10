'use client';

import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * The nearest scrollable ancestor's box (e.g. ModalDialog's `overflow-y-auto`
 * content wrapper), which is the actual clipping boundary for an
 * `absolute`-positioned popover — not the viewport, which can still have
 * plenty of room below while the scrollable container's own edge is close.
 * Falls back to the viewport when the trigger isn't inside a scrollable
 * container (the common case outside a modal).
 */
function findClipBoundary(el: HTMLElement): { bottom: number; top: number } {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node.getBoundingClientRect();
    }
    node = node.parentElement;
  }
  return { bottom: window.innerHeight, top: 0 };
}

/**
 * Decide whether a popover panel anchored below `triggerRef` should instead
 * open upward, when there isn't enough room below within the trigger's
 * scrollable container (e.g. a property picker near the bottom of
 * ModalDialog's `max-h-[90vh] overflow-y-auto`, which clips an
 * `absolute`-positioned panel that would otherwise extend past the
 * container's edge). Cheap heuristic: measured once per open, no
 * scroll-tracking.
 */
export function usePopoverFlip(open: boolean, triggerRef: RefObject<HTMLElement | null>): boolean {
  const [openUpward, setOpenUpward] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setOpenUpward(false);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const boundary = findClipBoundary(trigger);
    const spaceBelow = boundary.bottom - rect.bottom;
    const spaceAbove = rect.top - boundary.top;
    // Only flip when space below is tight and there's meaningfully more room above.
    setOpenUpward(spaceBelow < 160 && spaceAbove > spaceBelow);
  }, [open, triggerRef]);

  return openUpward;
}
