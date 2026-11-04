'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { StatusDot } from '@/components/properties/status-select';
import { cn } from '@/lib/utils';

const VIRTUAL_THRESHOLD = 20;

interface GroupSectionShared {
  /** Controlled collapse state; omit for the section to own it. */
  collapsed?: boolean;
  color: string;
  count: number;
  /** Render the rows with no header (a single ungrouped list). */
  hideHeader?: boolean;
  itemHeight?: number;
  /** Replaces the status dot, for groupings that aren't by status. */
  leading?: React.ReactNode;
  name: string;
  onCollapsedChange?: (collapsed: boolean) => void;
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
  hideHeader,
  leading,
  collapsed: collapsedProp,
  onCollapsedChange,
}: GroupSectionProps) {
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const collapsed = collapsedProp ?? ownCollapsed;
  const setCollapsed = (fn: (c: boolean) => boolean) => {
    if (onCollapsedChange) {
      onCollapsedChange(fn(collapsed));
    } else {
      setOwnCollapsed(fn);
    }
  };

  const useVirtual =
    items !== undefined && renderItem !== undefined && items.length > VIRTUAL_THRESHOLD;

  return (
    <div data-testid="group-section">
      {/* Group header — sticky so the group stays named while its rows scroll. */}
      {!hideHeader && (
        <button
          aria-expanded={!collapsed}
          className="sticky top-0 z-10 flex w-full items-center gap-2 bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          data-testid="group-header"
          onClick={() => setCollapsed(c => !c)}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('h-3.5 w-3.5 transition-transform', collapsed && '-rotate-90')}
          />
          {leading ?? <StatusDot color={color} />}
          <span className="text-foreground-secondary">{name}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
        </button>
      )}

      {/* Issues */}
      {(hideHeader || !collapsed) &&
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
