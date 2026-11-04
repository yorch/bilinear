'use client';

import { useEffect, useRef, useState } from 'react';
import { CHART_WIDTH } from './chart-geometry';

/**
 * Tracks the rendered width of a chart container so the SVG can lay itself out
 * at 1:1 pixels. A fixed viewBox scaled to fit made the text unreadable on
 * phones and left dead margins on wide cards.
 */
export function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(CHART_WIDTH);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const update = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) {
        setWidth(w);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
