import { useEffect, useRef, useState } from 'react';
import { useOutsideClick } from './use-outside-click';

interface UsePopoverOptions {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function usePopover({ forceOpen, onClose }: UsePopoverOptions = {}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  useOutsideClick(
    ref,
    () => {
      setOpen(false);
      onClose?.();
    },
    open,
  );

  return { open, ref, setOpen };
}
