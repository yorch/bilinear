'use client';

import { type KeyboardEvent, useCallback, useEffect, useId, useRef } from 'react';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { isRovingFocusKey, nextRovingIndex } from '@/lib/roving-focus';

interface UsePopoverPanelOptions {
  /**
   * CSS selector for what receives focus when the panel opens. Deliberately
   * **wider** than `itemSelector`: `SelectPopover` panels hold arbitrary consumer
   * markup, and several open onto a form control rather than a button — the
   * due-date picker's `<input type="date">`, the column picker's checkboxes, the
   * estimate picker's free-form number field. Collapsing the two selectors into
   * one silently moved initial focus onto whatever button happened to be first,
   * which on the due-date picker is "Clear date" — so the first Enter after
   * opening wiped the date instead of editing it.
   */
  focusSelector: string;
  /**
   * CSS selector for the elements Up/Down/Home/End rove between, relative to the
   * panel. Narrower on purpose: roving is a listbox affordance, so it covers the
   * option buttons and skips the form controls above.
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
export function usePopoverPanel(
  { focusSelector, itemSelector }: UsePopoverPanelOptions,
  open: boolean,
) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useRestoreFocus(open, triggerRef);

  // Open on the current value where there is one — the standard listbox
  // behaviour, and it saves arrowing back to where you already were. Falls back
  // to the first focusable thing in the panel, which may not be an option.
  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    const selected = panel?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? panel?.querySelector<HTMLElement>(focusSelector))?.focus();
  }, [open, focusSelector]);

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
