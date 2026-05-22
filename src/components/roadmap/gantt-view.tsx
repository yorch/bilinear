'use client';

import { addDays, addMonths, differenceInDays, format, startOfMonth } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface GanttItem {
  color?: string | null;
  endDate: string | null;
  href?: string;
  icon?: string | null;
  id: string;
  name: string;
  startDate: string | null;
  subtitle?: string | null;
}

interface GanttViewProps {
  /** Default span (in days) used when an item has only a start or only an end. */
  defaultSpanDays?: number;
  emptyMessage?: string;
  items: GanttItem[];
  onChange?: (id: string, startDate: string | null, endDate: string | null) => void;
  /** Day width in pixels. Defaults to 12 (≈1 month spans ~360px). */
  pxPerDay?: number;
}

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  endDateInitial: Date | null;
  id: string;
  mode: DragMode;
  startDateInitial: Date | null;
  startX: number;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  // Treat plain YYYY-MM-DD as a local date so the bar lines up with the day
  // label the user sees. new Date('YYYY-MM-DD') is UTC-midnight which can
  // shift across DST in some locales.
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) {
    return null;
  }
  return new Date(y, m - 1, d);
}

function fmtIso(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function GanttView({
  items,
  onChange,
  pxPerDay = 12,
  defaultSpanDays = 14,
  emptyMessage = 'No items with dates yet. Add start and target dates to populate the roadmap.',
}: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState(0);

  // Resolve effective (start, end) per item — if one side is missing, the bar
  // still renders with a sensible default span anchored to the present side.
  const resolved = useMemo(() => {
    const today = new Date();
    return items.map(item => {
      const s = parseDate(item.startDate);
      const e = parseDate(item.endDate);
      let start = s;
      let end = e;
      if (start && !end) {
        end = addDays(start, defaultSpanDays);
      } else if (!start && end) {
        start = addDays(end, -defaultSpanDays);
      } else if (!start && !end) {
        start = today;
        end = addDays(today, defaultSpanDays);
      }
      // Always ensure end >= start
      if (start && end && end < start) {
        end = start;
      }
      return { ...item, _effectiveEnd: end as Date, _effectiveStart: start as Date };
    });
  }, [items, defaultSpanDays]);

  // Compute the timeline window — earliest start to latest end, padded by a
  // month on each side. Recomputed only when items change so drag doesn't
  // shift the underlying axis.
  const { windowStart, windowEnd, totalDays } = useMemo(() => {
    if (resolved.length === 0) {
      const today = new Date();
      const ws = startOfMonth(addMonths(today, -1));
      const we = addMonths(ws, 3);
      return { totalDays: differenceInDays(we, ws), windowEnd: we, windowStart: ws };
    }
    // Use reduce rather than Math.min(...starts) — spreading thousands of
    // arguments hits engine argument-count caps on large workspaces, and
    // a single NaN element silently poisons the entire window. The reduce
    // keeps the time complexity the same with bounded stack usage and
    // lets us drop NaN rows defensively.
    let minStartMs = Number.POSITIVE_INFINITY;
    let maxEndMs = Number.NEGATIVE_INFINITY;
    for (const r of resolved) {
      const s = r._effectiveStart.getTime();
      const e = r._effectiveEnd.getTime();
      if (Number.isFinite(s) && s < minStartMs) {
        minStartMs = s;
      }
      if (Number.isFinite(e) && e > maxEndMs) {
        maxEndMs = e;
      }
    }
    if (!Number.isFinite(minStartMs) || !Number.isFinite(maxEndMs)) {
      const today = new Date();
      const ws0 = startOfMonth(addMonths(today, -1));
      const we0 = addMonths(ws0, 3);
      return { totalDays: differenceInDays(we0, ws0), windowEnd: we0, windowStart: ws0 };
    }
    const ws = startOfMonth(addMonths(new Date(minStartMs), -1));
    const we = startOfMonth(addMonths(new Date(maxEndMs), 2));
    return { totalDays: differenceInDays(we, ws), windowEnd: we, windowStart: ws };
  }, [resolved]);

  // Generate the month grid for the header. Each month gets an x offset.
  const monthMarkers = useMemo(() => {
    const markers: Array<{ label: string; x: number }> = [];
    let cur = windowStart;
    while (cur < windowEnd) {
      const days = differenceInDays(cur, windowStart);
      markers.push({ label: format(cur, 'MMM yyyy'), x: days * pxPerDay });
      cur = addMonths(cur, 1);
    }
    return markers;
  }, [windowStart, windowEnd, pxPerDay]);

  const dayToX = useCallback(
    (date: Date) => differenceInDays(date, windowStart) * pxPerDay,
    [windowStart, pxPerDay],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!drag) {
        return;
      }
      const dx = e.clientX - drag.startX;
      const days = Math.round(dx / pxPerDay);
      setDragDelta(days);
    },
    [drag, pxPerDay],
  );

  const onMouseUp = useCallback(() => {
    if (!drag) {
      return;
    }
    const days = dragDelta;
    setDrag(null);
    setDragDelta(0);
    if (days === 0 || !onChange) {
      return;
    }
    let newStart = drag.startDateInitial;
    let newEnd = drag.endDateInitial;
    if (drag.mode === 'move') {
      newStart = drag.startDateInitial ? addDays(drag.startDateInitial, days) : null;
      newEnd = drag.endDateInitial ? addDays(drag.endDateInitial, days) : null;
    } else if (drag.mode === 'resize-start') {
      newStart = drag.startDateInitial ? addDays(drag.startDateInitial, days) : null;
      // Don't allow start to cross past end
      if (newStart && drag.endDateInitial && newStart > drag.endDateInitial) {
        newStart = drag.endDateInitial;
      }
    } else if (drag.mode === 'resize-end') {
      newEnd = drag.endDateInitial ? addDays(drag.endDateInitial, days) : null;
      if (newEnd && drag.startDateInitial && newEnd < drag.startDateInitial) {
        newEnd = drag.startDateInitial;
      }
    }
    onChange(drag.id, newStart ? fmtIso(newStart) : null, newEnd ? fmtIso(newEnd) : null);
  }, [drag, dragDelta, onChange]);

  useEffect(() => {
    if (!drag) {
      return;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drag, onMouseMove, onMouseUp]);

  const startDrag = (item: GanttItem, mode: DragMode, e: React.MouseEvent) => {
    if (!onChange) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Fall back to the effective (synthesized) date when the underlying
    // item has only one side set or none at all. Without this, dragging
    // a resize handle on a one-sided bar produces a moving visual
    // preview but `newStart = null ? addDays(...) : null` short-circuits
    // to null on mouseup, so the change is silently discarded.
    const effective = resolved.find(r => r.id === item.id);
    setDrag({
      endDateInitial: parseDate(item.endDate) ?? effective?._effectiveEnd ?? null,
      id: item.id,
      mode,
      startDateInitial: parseDate(item.startDate) ?? effective?._effectiveStart ?? null,
      startX: e.clientX,
    });
  };

  if (items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center px-6 py-12 text-center text-sm text-zinc-400">
        {emptyMessage}
      </div>
    );
  }

  const todayX = dayToX(new Date());
  const totalWidth = totalDays * pxPerDay;
  const rowHeight = 36;

  return (
    <div className="overflow-x-auto" ref={containerRef}>
      <div style={{ minWidth: totalWidth }}>
        {/* Month header */}
        <div className="sticky top-0 z-10 flex h-8 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          {monthMarkers.map((m, i) => {
            const nextX = monthMarkers[i + 1]?.x ?? totalWidth;
            return (
              <div
                className="border-r border-zinc-100 px-2 text-xs font-medium leading-8 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                key={m.label}
                style={{ width: nextX - m.x }}
              >
                {m.label}
              </div>
            );
          })}
        </div>

        <div className="relative" style={{ height: items.length * rowHeight }}>
          {/* Today line */}
          {todayX >= 0 && todayX <= totalWidth && (
            <div
              aria-hidden="true"
              className="absolute top-0 z-0 w-px bg-red-400/60"
              style={{ height: items.length * rowHeight, left: todayX }}
            />
          )}

          {resolved.map((item, idx) => {
            const baseX = dayToX(item._effectiveStart);
            const baseWidth =
              (differenceInDays(item._effectiveEnd, item._effectiveStart) + 1) * pxPerDay;

            // Apply drag preview transform
            let x = baseX;
            let w = baseWidth;
            if (drag && drag.id === item.id && dragDelta !== 0) {
              const px = dragDelta * pxPerDay;
              if (drag.mode === 'move') {
                x = baseX + px;
              } else if (drag.mode === 'resize-start') {
                x = baseX + px;
                w = Math.max(pxPerDay, baseWidth - px);
              } else if (drag.mode === 'resize-end') {
                w = Math.max(pxPerDay, baseWidth + px);
              }
            }

            const color = item.color ?? '#6366f1';
            const isDragging = drag?.id === item.id;

            return (
              <div
                className="group absolute flex items-center"
                key={item.id}
                style={{ height: rowHeight, top: idx * rowHeight, width: totalWidth }}
              >
                {/* biome-ignore lint/a11y/useSemanticElements: contains nested <button> resize handles; nesting <button> in <button> is invalid HTML */}
                <div
                  aria-label={`Drag ${item.name} timeline bar`}
                  className={cn(
                    'absolute flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium text-white shadow-sm transition-shadow',
                    !isDragging && 'cursor-grab',
                    isDragging && 'cursor-grabbing shadow-md',
                  )}
                  onMouseDown={e => startDrag(item, 'move', e)}
                  role="button"
                  style={{
                    backgroundColor: color,
                    borderColor: color,
                    left: x,
                    width: Math.max(w, pxPerDay * 1.5),
                  }}
                  tabIndex={0}
                >
                  {/* Resize handle - left */}
                  <button
                    aria-label="Resize start"
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md bg-black/10 opacity-0 transition-opacity group-hover:opacity-100"
                    onMouseDown={e => startDrag(item, 'resize-start', e)}
                    tabIndex={-1}
                    type="button"
                  />
                  <span className="truncate">
                    {item.icon ? `${item.icon} ` : ''}
                    {item.name}
                  </span>
                  {item.subtitle && (
                    <span className="ml-1 truncate text-[10px] opacity-80">{item.subtitle}</span>
                  )}
                  {/* Resize handle - right */}
                  <button
                    aria-label="Resize end"
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md bg-black/10 opacity-0 transition-opacity group-hover:opacity-100"
                    onMouseDown={e => startDrag(item, 'resize-end', e)}
                    tabIndex={-1}
                    type="button"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
