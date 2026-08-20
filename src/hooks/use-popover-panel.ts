'use client';

import { type KeyboardEvent, useCallback, useEffect, useId, useRef } from 'react';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { isRovingFocusKey, nextRovingIndex } from '@/lib/roving-focus';

/** Everything a panel can hand initial focus to, when nothing claims it. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface UsePopoverPanelOptions {
  /**
   * CSS selector for the elements Up/Down/Home/End rove between, relative to the
   * panel. Roving is a listbox affordance, so it covers the option buttons and
   * skips any form controls above them.
   */
  itemSelector: string;
}

/**
 * The keyboard and focus contract shared by every popover panel: focus moves in
 * on open, Up/Down/Home/End rove across the items, and focus returns to the
 * trigger on close.
 *
 * Extracted because `SelectPopover` and `SimpleSelect` each carried their own
 * copy, and they had drifted apart once already: `SimpleSelect` shipped without
 * the Escape route and without the focus restore, which together made an open
 * panel a keyboard trap. That was fixed separately, before this extraction —
 * the point of sharing the contract now is that they cannot drift again.
 *
 * The two remain separate components deliberately. `SimpleSelect` is a bordered
 * form control that needs a trigger `id` to pair with a `<label htmlFor>`, an
 * `aria-label` for the rows whose visible label is a plain `<span>`, and a
 * non-selectable caption row above its options; folding it into `SelectPopover`
 * means growing the shared primitive with three props that exist for one shape.
 */
export function usePopoverPanel({ itemSelector }: UsePopoverPanelOptions, open: boolean) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useRestoreFocus(open, triggerRef);

  /**
   * Focus order on open: a panel that names its own target wins, then the
   * current value, then whatever is focusable first.
   *
   * The `data-autofocus` opt-in exists because inferring intent from markup
   * order gets it wrong, and wrong here is costly. `querySelector` returns the
   * first match in *document* order, so the due-date panel — whose "Clear date"
   * button sits after the date field only when a date is set — would hand focus
   * to the clear button, and the first Enter after opening would wipe the date.
   * The estimate picker's free-form branch has the same shape, and additionally
   * self-focuses its number field, so the two mechanisms fought and this one won
   * (parent effects run after child effects).
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    const claimed = panel?.querySelector<HTMLElement>('[data-autofocus]');
    const selected = panel?.querySelector<HTMLElement>('[aria-selected="true"]');
    (claimed ?? selected ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
  }, [open]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!isRovingFocusKey(e.key)) {
        return;
      }
      // A panel may hold a search field (SearchableSelectPopover's sibling
      // shape); arrow keys there belong to the caret, not the list.
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(itemSelector) ?? []);
      if (items.length === 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const idx = items.indexOf(document.activeElement as HTMLElement);
      items[nextRovingIndex(e.key, idx, items.length)]?.focus();
    },
    [itemSelector],
  );

  return { onKeyDown, panelId, panelRef, triggerRef };
}
