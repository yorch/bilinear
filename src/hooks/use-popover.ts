import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutsideClick } from './use-outside-click';

interface UsePopoverOptions {
  /** Also close on Escape, regardless of which element inside the popover has focus. */
  closeOnEscape?: boolean;
  /** Uncontrolled: forces the popover open once; the popover still manages its own close. */
  forceOpen?: boolean;
  onClose?: () => void;
  /** Fully controlled open state. When set, overrides internal state (parent owns open/close). */
  open?: boolean;
}

export function usePopover({
  closeOnEscape = false,
  forceOpen,
  onClose,
  open: controlledOpen,
}: UsePopoverOptions = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // When `open` is controlled, the returned `setOpen` only touches unused internal
  // state — the parent must flip its own `open` prop (typically from `onClose`) to close.
  const open = controlledOpen ?? internalOpen;

  useEffect(() => {
    if (forceOpen) {
      setInternalOpen(true);
    }
  }, [forceOpen]);

  const handleDismiss = useCallback(() => {
    setInternalOpen(false);
    onClose?.();
  }, [onClose]);

  useOutsideClick(ref, handleDismiss, open, closeOnEscape);

  return { open, ref, setOpen: setInternalOpen };
}
