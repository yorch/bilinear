'use client';

import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip for collapsed-rail items.
 *
 * The rail's labels used to be native `title` attributes: they show after a
 * delay, never on keyboard focus, and never on touch. The sidebar scrolls
 * (`overflow-y-auto`), which clips an absolutely-positioned child, so the tip
 * is portalled and positioned from the trigger's rect. Shown on hover AND
 * focus-within; `aria-describedby` is set on the control itself (the focusable
 * child), it is dismissed by Escape (WCAG 1.4.13) and on scroll, where its
 * fixed position would go stale.
 */
export function RailTooltip({ children, label }: { children: ReactNode; label: string }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setPos({ left: rect.right + 8, top: rect.top + rect.height / 2 });
    }
  };
  const hide = () => setPos(null);

  const visible = pos !== null;
  useEffect(() => {
    if (!visible) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPos(null);
      }
    };
    const onScroll = () => setPos(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [visible]);

  const control =
    pos && isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': id,
        })
      : children;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper only forwards hover/focus of the control inside it
    <div onBlur={hide} onFocus={show} onMouseEnter={show} onMouseLeave={hide} ref={ref}>
      {control}
      {pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-foreground shadow-e2"
            id={id}
            role="tooltip"
            style={{ left: pos.left, top: pos.top }}
          >
            {label}
          </div>,
          document.body,
        )}
    </div>
  );
}
