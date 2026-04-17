'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { StatusDot } from '../properties/status-select';

const VIRTUAL_THRESHOLD = 20;

/**
 * A collapsible group header with two rendering strategies:
 *
 * **`children` (non-virtual)** — use for small lists (≤20 items).
 * Pass your rendered rows directly as children. Simple, composable, no overhead.
 *
 * **`items` + `renderItem` (virtual)** — use for large lists (>20 items).
 * Pass the raw data array and a render function; `useVirtualizer` is activated
 * automatically and only the visible rows are mounted. Requires a fixed
 * `itemHeight` (default 36px) for accurate scrollbar sizing.
 *
 * If `items` is provided but has ≤20 entries the component transparently falls
 * back to the non-virtual `children` path, so you can always pass both and let
 * the component decide.
 */
interface GroupSectionProps {
  name: string;
  color: string;
  count: number;
  children?: React.ReactNode;
  items?: unknown[];
  renderItem?: (item: unknown, index: number) => React.ReactNode;
  itemHeight?: number;
}

function VirtualizedList({
  items,
  renderItem,
  itemHeight,
}: {
  items: unknown[];
  renderItem: (item: unknown, index: number) => React.ReactNode;
  itemHeight: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => itemHeight,
    getScrollElement: () => parentRef.current,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto"
      style={{ maxHeight: 'min(600px, 60vh)' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            style={{
              height: `${virtualItem.size}px`,
              left: 0,
              position: 'absolute',
              right: 0,
              top: `${virtualItem.start}px`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GroupSection({
  name,
  color,
  count,
  children,
  items,
  renderItem,
  itemHeight = 36,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const useVirtual =
    items !== undefined &&
    renderItem !== undefined &&
    items.length > VIRTUAL_THRESHOLD;

  return (
    <div data-testid="group-section">
      {/* Group header */}
      <button
        type="button"
        data-testid="group-header"
        className="flex w-full items-center gap-2 px-4 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        onClick={() => setCollapsed(c => !c)}
      >
        <span
          className={cn(
            'inline-block transition-transform',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
        >
          ▾
        </span>
        <StatusDot color={color} />
        <span className="text-zinc-700 dark:text-zinc-300">{name}</span>
        <span className="text-zinc-400">{count}</span>
      </button>

      {/* Issues */}
      {!collapsed &&
        (useVirtual ? (
          <VirtualizedList
            items={items}
            renderItem={renderItem}
            itemHeight={itemHeight}
          />
        ) : items !== undefined && renderItem !== undefined ? (
          items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items are stable within a group; no stable key available at this layer
            <div key={i}>{renderItem(item, i)}</div>
          ))
        ) : (
          children
        ))}
    </div>
  );
}
