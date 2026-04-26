'use client';

import { RefreshCw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import type { DBCycle } from '@/lib/db';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface CycleSelectProps {
  onChange: (cycleId: string | null) => void;
  onClose?: () => void;
  open?: boolean;
  teamId: string;
  value: string | null;
}

function getCycleDisplayName(cycle: DBCycle): string {
  return cycle.name || `Cycle ${cycle.number}`;
}

export const CycleSelect = observer(function CycleSelect({
  value,
  teamId,
  onChange,
  open: controlledOpen,
  onClose,
}: CycleSelectProps) {
  const { cycleStore } = useStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = controlledOpen ?? internalOpen;

  const cycles = cycleStore.findByTeamId(teamId);
  const current = value ? cycleStore.findById(value) : null;

  const filtered = search.trim()
    ? cycles.filter(c => getCycleDisplayName(c).toLowerCase().includes(search.toLowerCase()))
    : cycles;

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setInternalOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const handleSelect = (cycleId: string | null) => {
    onChange(cycleId);
    setInternalOpen(false);
    onClose?.();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        onClick={() => {
          if (isOpen) {
            setInternalOpen(false);
            onClose?.();
          } else {
            setInternalOpen(true);
          }
        }}
        title="Set cycle (Q)"
        type="button"
      >
        <RefreshCw className="h-3 w-3" />
        {current ? (
          <span className="max-w-[100px] truncate">{getCycleDisplayName(current)}</span>
        ) : (
          <span className="text-zinc-400">Cycle</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input
            className="mb-1 w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700"
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setInternalOpen(false);
                onClose?.();
              }
            }}
            placeholder="Search cycles..."
            ref={inputRef}
            type="text"
            value={search}
          />

          {value && (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => handleSelect(null)}
              type="button"
            >
              <X className="h-3 w-3" />
              Remove from cycle
            </button>
          )}

          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-400">No cycles found</p>
            ) : (
              filtered.map(cycle => {
                const now = Date.now();
                const startsAtMs = new Date(cycle.startsAt).getTime();
                const endsAtMs = new Date(cycle.endsAt).getTime();
                const isActive = !cycle.completedAt && startsAtMs <= now && endsAtMs > now;

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
                      cycle.id === value
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'text-zinc-700 dark:text-zinc-300',
                    )}
                    key={cycle.id}
                    onClick={() => handleSelect(cycle.id)}
                    type="button"
                  >
                    <RefreshCw className="h-3 w-3 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {getCycleDisplayName(cycle)}
                    </span>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        Active
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
});
