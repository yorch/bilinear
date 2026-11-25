'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ScrollXProps {
  children: ReactNode;
  className?: string;
}

/**
 * Horizontal scroller that says so. A wide table inside a bare
 * `overflow-x-auto` box gives no cue that more columns sit off-screen on a
 * phone; this fades whichever edge still has content past it, and the fade
 * disappears once that edge is reached. The fades are `pointer-events-none`
 * and `aria-hidden`, so they never intercept a tap or reach assistive tech.
 */
export function ScrollX({ children, className }: ScrollXProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ end: false, start: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges(prev => (prev.start === start && prev.end === end ? prev : { end, start }));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className={cn('relative', className)}>
      <div className="overflow-x-auto" onScroll={measure} ref={ref}>
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent transition-opacity',
          edges.start ? 'opacity-100' : 'opacity-0',
        )}
        data-edge="start"
      />
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent transition-opacity',
          edges.end ? 'opacity-100' : 'opacity-0',
        )}
        data-edge="end"
      />
    </div>
  );
}
