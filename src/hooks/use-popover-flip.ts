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

const PANEL_GAP_PX = 4;
const PANEL_MARGIN_PX = 8;
/** Tailwind `md`: below it panels are fixed bottom sheets that size themselves. */
const MD_BREAKPOINT_PX = 768;

export interface PopoverPlacement {
  /** Pixel cap for the panel when it fits on neither side; null when no clamp is needed. */
  maxHeight: number | null;
  openUpward: boolean;
}

const DEFAULT_PLACEMENT: PopoverPlacement = { maxHeight: null, openUpward: false };

/**
 * Decide whether a popover panel anchored below `triggerRef` should instead
 * open upward, when there isn't enough room below within the trigger's
 * scrollable container (e.g. a property picker near the bottom of
 * ModalDialog's `max-h-[90vh] overflow-y-auto`, which clips an
 * `absolute`-positioned panel that would otherwise extend past the
 * container's edge). When the measured panel fits on neither side it opens on
 * the roomier side and reports a `maxHeight` so the caller can clamp it and
 * scroll inside. Cheap heuristic: measured once per open, no scroll-tracking.
 */
export function usePopoverPlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef?: RefObject<HTMLElement | null>,
): PopoverPlacement {
  const [placement, setPlacement] = useState<PopoverPlacement>(DEFAULT_PLACEMENT);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(prev => (prev === DEFAULT_PLACEMENT ? prev : DEFAULT_PLACEMENT));
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
    // A tall panel (the due-date calendar is ~380px) needs more than the fixed
    // 160px floor, so when the rendered panel is available, require its real
    // height plus the 4px gap. Either way only flip when there is more room above.
    const panelHeight = panelRef?.current?.getBoundingClientRect().height ?? 0;
    const needed = Math.max(160, panelHeight + PANEL_GAP_PX);
    const openUpward = spaceBelow < needed && spaceAbove > spaceBelow;
    const room = (openUpward ? spaceAbove : spaceBelow) - PANEL_GAP_PX - PANEL_MARGIN_PX;
    const clamp = panelHeight > room && window.innerWidth >= MD_BREAKPOINT_PX;
    const maxHeight = clamp ? Math.max(room, 0) : null;
    // Bail out on an unchanged result so an unstable ref object can't loop.
    setPlacement(prev =>
      prev.maxHeight === maxHeight && prev.openUpward === openUpward
        ? prev
        : { maxHeight, openUpward },
    );
  }, [open, triggerRef, panelRef]);

  return placement;
}

export function usePopoverFlip(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef?: RefObject<HTMLElement | null>,
): boolean {
  return usePopoverPlacement(open, triggerRef, panelRef).openUpward;
}
