'use client';

import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { StatusDot } from '../properties/status-select';

const VIRTUAL_THRESHOLD = 20;

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
        ) : (
          children
        ))}
    </div>
  );
}
