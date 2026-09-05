'use client';

import { addDays, addMonths, differenceInDays, format, startOfMonth } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
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

export type GanttZoom = 'day' | 'week' | 'month';

const ZOOM_PX: Record<GanttZoom, number> = {
  day: 48,
  month: 4,
  week: 14,
};

const ZOOM_LABEL_KEYS: Record<GanttZoom, string> = {
  day: 'roadmap.gantt.zoomDay',
  month: 'roadmap.gantt.zoomMonth',
  week: 'roadmap.gantt.zoomWeek',
};

interface GanttViewProps {
  /** Default span (in days) used when an item has only a start or only an end. */
  defaultSpanDays?: number;
  emptyMessage?: string;
  items: GanttItem[];
  onChange?: (id: string, startDate: string | null, endDate: string | null) => void;
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

/**
 * Apply a whole-day delta to a bar for the given interaction. `move` shifts
 * both ends; a resize moves one end and never lets it cross the other. Shared
 * by mouse drag (delta from pixels) and the keyboard nudge (±1 day).
 */
export function shiftRange(
  mode: DragMode,
  start: Date | null,
  end: Date | null,
  days: number,
): { end: Date | null; start: Date | null } {
  if (mode === 'move') {
    return { end: end ? addDays(end, days) : null, start: start ? addDays(start, days) : null };
  }
  if (mode === 'resize-start') {
    let newStart = start ? addDays(start, days) : null;
    if (newStart && end && newStart > end) {
      newStart = end;
    }
    return { end, start: newStart };
  }
  let newEnd = end ? addDays(end, days) : null;
  if (newEnd && start && newEnd < start) {
    newEnd = start;
  }
  return { end: newEnd, start };
}

export function GanttView({ items, onChange, defaultSpanDays = 14, emptyMessage }: GanttViewProps) {
  const t = useTranslations();
  const { dateFnsLocale } = useFormatters();
  const resolvedEmptyMessage = emptyMessage ?? t('roadmap.gantt.emptyMessage');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState(0);

  const pxPerDay = ZOOM_PX[zoom];

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
      markers.push({
        label: format(cur, 'MMM yyyy', { locale: dateFnsLocale }),
        x: days * pxPerDay,
      });
      cur = addMonths(cur, 1);
    }
    return markers;
  }, [windowStart, windowEnd, pxPerDay, dateFnsLocale]);

  // Week tick marks — one every 7 days from windowStart.
  const weekMarkers = useMemo(() => {
    if (zoom !== 'week') {
      return [];
    }
    const markers: Array<{ label: string; x: number }> = [];
    let cur = windowStart;
    while (cur < windowEnd) {
      markers.push({
        label: format(cur, 'd'),
        x: differenceInDays(cur, windowStart) * pxPerDay,
      });
      cur = addDays(cur, 7);
    }
    return markers;
  }, [windowStart, windowEnd, zoom, pxPerDay]);

  // Day tick marks — one per day.
  const dayMarkers = useMemo(() => {
    if (zoom !== 'day') {
      return [];
    }
    const markers: Array<{ isMonthStart: boolean; label: string; x: number }> = [];
    let cur = windowStart;
    while (cur < windowEnd) {
      markers.push({
        isMonthStart: cur.getDate() === 1,
        label: format(cur, 'd'),
        x: differenceInDays(cur, windowStart) * pxPerDay,
      });
      cur = addDays(cur, 1);
    }
    return markers;
  }, [windowStart, windowEnd, zoom, pxPerDay]);

  const dayToX = useCallback(
    (date: Date) => differenceInDays(date, windowStart) * pxPerDay,
    [windowStart, pxPerDay],
  );

  // Scroll to centre "today" only when the zoom level (and therefore pxPerDay)
  // actually changes — not on windowStart updates caused by item mutations.
  // prevPxRef is null on first render so the initial mount always centres today.
  const prevPxRef = useRef<number | null>(null);
  useEffect(() => {
    if (pxPerDay === prevPxRef.current) {
      return;
    }
    prevPxRef.current = pxPerDay;
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const todayX = differenceInDays(new Date(), windowStart) * pxPerDay;
    const halfW = container.clientWidth / 2;
    container.scrollLeft = Math.max(0, todayX - halfW);
  }, [windowStart, pxPerDay]);

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
    const { end: newEnd, start: newStart } = shiftRange(
      drag.mode,
      drag.startDateInitial,
      drag.endDateInitial,
      days,
    );
    onChange(drag.id, newStart ? fmtIso(newStart) : null, newEnd ? fmtIso(newEnd) : null);
  }, [drag, dragDelta, onChange]);

  // Keyboard counterpart of a `move` drag: the bar is focusable (`tabIndex=0`),
  // so Left/Right must actually do what the mouse does or the focus stop is a
  // dead end for keyboard users.
  const nudge = (
    item: GanttItem & { _effectiveEnd: Date; _effectiveStart: Date },
    days: number,
  ) => {
    if (!onChange) {
      return;
    }
    const { end, start } = shiftRange(
      'move',
      parseDate(item.startDate) ?? item._effectiveStart,
      parseDate(item.endDate) ?? item._effectiveEnd,
      days,
    );
    onChange(item.id, start ? fmtIso(start) : null, end ? fmtIso(end) : null);
  };

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
      <div className="flex h-48 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
        {resolvedEmptyMessage}
      </div>
    );
  }

  const todayX = dayToX(new Date());
  const totalWidth = totalDays * pxPerDay;
  const rowHeight = 36;
  const hasSubRow = zoom !== 'month';

  return (
    <div className="flex flex-col">
      {/* Zoom controls */}
      <div className="flex items-center justify-end border-b border-border px-3 py-1.5">
        <fieldset
          aria-label={t('roadmap.gantt.zoomLevel')}
          className="flex gap-0.5 rounded-md border border-border p-0.5"
        >
          {(['month', 'week', 'day'] as GanttZoom[]).map(z => (
            <button
              aria-pressed={zoom === z}
              className={cn(
                'rounded px-2.5 py-0.5 text-xs font-medium transition-colors',
                zoom === z
                  ? 'bg-invert text-invert-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              key={z}
              onClick={() => setZoom(z)}
              type="button"
            >
              {t(ZOOM_LABEL_KEYS[z])}
            </button>
          ))}
        </fieldset>
      </div>

      {/* Scrollable timeline */}
      <div className="overflow-x-auto" ref={containerRef}>
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-border bg-background">
            {/* Month row */}
            <div className={cn('flex border-b border-border', hasSubRow ? 'h-6' : 'h-8')}>
              {monthMarkers.map((m, i) => {
                const nextX = monthMarkers[i + 1]?.x ?? totalWidth;
                return (
                  <div
                    className="overflow-hidden border-r border-border px-2 text-xs font-medium leading-6 text-muted-foreground"
                    key={m.label}
                    style={{ width: nextX - m.x }}
                  >
                    {m.label}
                  </div>
                );
              })}
            </div>

            {/* Sub-row: week ticks or day numbers */}
            {hasSubRow && (
              <div className="relative h-5">
                {zoom === 'week' &&
                  weekMarkers.map(wm => (
                    <div
                      className="absolute top-0 border-l border-border px-1 text-[10px] leading-5 text-muted-foreground"
                      key={wm.x}
                      style={{ left: wm.x }}
                    >
                      {wm.label}
                    </div>
                  ))}
                {zoom === 'day' &&
                  dayMarkers.map(dm => (
                    <div
                      className={cn(
                        'absolute top-0 border-l px-0.5 text-[10px] leading-5 text-muted-foreground',
                        dm.isMonthStart ? 'border-border font-semibold' : 'border-border',
                      )}
                      key={dm.x}
                      style={{ left: dm.x, width: pxPerDay }}
                    >
                      {dm.label}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="relative" style={{ height: items.length * rowHeight }}>
            {/* Today line */}
            {todayX >= 0 && todayX <= totalWidth && (
              <div
                aria-hidden="true"
                className="absolute top-0 z-0 w-px bg-danger/60"
                style={{ height: items.length * rowHeight, left: todayX }}
              />
            )}

            {/* Subtle vertical grid lines for week/day zoom */}
            {zoom === 'week' &&
              weekMarkers.map(wm => (
                <div
                  aria-hidden="true"
                  className="absolute top-0 w-px bg-muted"
                  key={wm.x}
                  style={{ height: items.length * rowHeight, left: wm.x }}
                />
              ))}
            {zoom === 'day' &&
              dayMarkers
                .filter(dm => dm.isMonthStart)
                .map(dm => (
                  <div
                    aria-hidden="true"
                    className="absolute top-0 w-px bg-muted"
                    key={dm.x}
                    style={{ height: items.length * rowHeight, left: dm.x }}
                  />
                ))}

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

              const color = item.color ?? 'var(--brand)';
              const isDragging = drag?.id === item.id;

              return (
                <div
                  className="group absolute flex items-center"
                  key={item.id}
                  style={{ height: rowHeight, top: idx * rowHeight, width: totalWidth }}
                >
                  {/* biome-ignore lint/a11y/useSemanticElements: contains nested <button> resize handles; nesting <button> in <button> is invalid HTML */}
                  <div
                    aria-label={t('roadmap.gantt.dragBar', { name: item.name })}
                    className={cn(
                      'absolute flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium text-white shadow-e1 transition-shadow',
                      !isDragging && 'cursor-grab',
                      isDragging && 'cursor-grabbing shadow-e2',
                    )}
                    onKeyDown={e => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        nudge(item, e.key === 'ArrowRight' ? 1 : -1);
                      }
                    }}
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
                      aria-label={t('roadmap.gantt.resizeStart')}
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
                      aria-label={t('roadmap.gantt.resizeEnd')}
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
    </div>
  );
}
