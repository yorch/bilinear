'use client';

import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Decide whether a popover panel anchored below `triggerRef` should instead
 * open upward, when there isn't enough room below within the viewport (e.g. a
 * property picker near the bottom of a scrollable modal — see ModalDialog's
 * `max-h-[90vh] overflow-y-auto`, which clips an `absolute`-positioned panel
 * that would otherwise extend past the container's edge). Cheap heuristic:
 * measured once per open, no scroll-tracking.
 */
export function usePopoverFlip(open: boolean, triggerRef: RefObject<HTMLElement | null>): boolean {
  const [openUpward, setOpenUpward] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setOpenUpward(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Only flip when space below is tight and there's meaningfully more room above.
    setOpenUpward(spaceBelow < 160 && spaceAbove > spaceBelow);
  }, [open, triggerRef]);

  return openUpward;
}
