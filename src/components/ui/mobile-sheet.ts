/**
 * Below `md` a popover panel becomes a fixed bottom sheet pinned to the
 * viewport, instead of an absolutely-positioned box that can overflow or clip
 * against its trigger (a 266px calendar anchored to a chip near the left edge
 * opens off-screen on a 390px phone). The height is capped to the dynamic
 * viewport and scrolls inside, so a tall panel is never taller than the screen.
 *
 * Pass as part of a `SelectPopover` `panelClassName`. `max-md:` classes only;
 * from `md` up the panel keeps its anchored layout.
 */
export const MOBILE_SHEET =
  'max-md:fixed max-md:inset-x-2 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:top-auto max-md:mb-0 max-md:mt-0 max-md:max-h-[calc(100dvh-2rem)] max-md:w-auto max-md:overflow-y-auto';
