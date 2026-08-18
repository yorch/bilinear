'use client';

import { type KeyboardEvent, useCallback, useEffect, useId, useRef } from 'react';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { isRovingFocusKey, nextRovingIndex } from '@/lib/roving-focus';

interface UsePopoverPanelOptions {
  /**
   * CSS selector for the elements Up/Down/Home/End rove between, relative to the
   * panel. `SelectPopover` panels hold arbitrary consumer markup so they rove
   * across every enabled button; `SimpleSelect` renders a strict listbox and
   * roves across its options only.
   */
  itemSelector: string;
}

/**
 * The keyboard and focus contract shared by every popover panel: focus moves in
 * on open, Up/Down/Home/End rove across the items, and focus returns to the
 * trigger on close.
 *
 * Extracted because `SelectPopover` and `SimpleSelect` each carried their own
 * copy, and they had already drifted — `SimpleSelect` shipped without the
 * Escape route and without the focus restore, which together made an open panel
 * a keyboard trap. Behaviour that must hold for both belongs in one place;
 * only the item selector genuinely differs, so only that is a parameter.
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

  // Open on the current value where there is one — the standard listbox
  // behaviour, and it saves arrowing back to where you already were.
  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    const selected = panel?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? panel?.querySelector<HTMLElement>(itemSelector))?.focus();
  }, [open, itemSelector]);

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
