'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { StatusDot } from '@/components/properties/status-select';
import { cn } from '@/lib/utils';

const VIRTUAL_THRESHOLD = 20;

interface GroupSectionShared {
  color: string;
  count: number;
  itemHeight?: number;
  name: string;
}

/**
 * **Children mode** — render pre-built rows directly. Use for small or
 * heterogeneous lists where each row is already JSX.
 */
interface GroupSectionChildrenProps extends GroupSectionShared {
  children: React.ReactNode;
  getKey?: never;
  items?: never;
  renderItem?: never;
}

/**
 * **Items mode** — pass raw data; the component picks virtual rendering
 * automatically when the list exceeds the VIRTUAL_THRESHOLD. `getKey`
 * is required to prevent index-as-key bugs on reorder.
 */
interface GroupSectionItemsProps extends GroupSectionShared {
  children?: never;
  getKey: (item: unknown, index: number) => string;
  items: unknown[];
  renderItem: (item: unknown, index: number) => React.ReactNode;
}

type GroupSectionProps = GroupSectionChildrenProps | GroupSectionItemsProps;

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
    <div className="overflow-y-auto" ref={parentRef} style={{ maxHeight: 'min(600px, 60vh)' }}>
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
  getKey,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const useVirtual =
    items !== undefined && renderItem !== undefined && items.length > VIRTUAL_THRESHOLD;

  return (
    <div data-testid="group-section">
      {/* Group header */}
      <button
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
        data-testid="group-header"
        onClick={() => setCollapsed(c => !c)}
        type="button"
      >
        <span
          className={cn('inline-block transition-transform', collapsed ? '-rotate-90' : 'rotate-0')}
        >
          ▾
        </span>
        <StatusDot color={color} />
        <span className="text-foreground-secondary">{name}</span>
        <span className="text-muted-foreground">{count}</span>
      </button>

      {/* Issues */}
      {!collapsed &&
        (useVirtual ? (
          <VirtualizedList itemHeight={itemHeight} items={items} renderItem={renderItem} />
        ) : items !== undefined && renderItem !== undefined ? (
          items.map((item, i) => <div key={getKey(item, i)}>{renderItem(item, i)}</div>)
        ) : (
          children
        ))}
    </div>
  );
}
