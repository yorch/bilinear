'use client';

import { Target, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface ProjectSelectProps {
  onChange: (projectId: string | null) => void;
  onClose?: () => void;
  open?: boolean;
  value: string | null;
}

export const ProjectSelect = observer(function ProjectSelect({
  value,
  onChange,
  open: controlledOpen,
  onClose,
}: ProjectSelectProps) {
  const { projectStore } = useStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = controlledOpen ?? internalOpen;

  const projects = projectStore.all;
  const current = value ? projectStore.findById(value) : null;

  const filtered = search.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useOutsideClick(
    containerRef,
    () => {
      setInternalOpen(false);
      onClose?.();
    },
    isOpen,
  );

  const handleSelect = (projectId: string | null) => {
    onChange(projectId);
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
        title="Set project (Shift+P)"
        type="button"
      >
        <Target className="h-3 w-3" />
        {current ? (
          <span className="truncate max-w-[100px]">{current.name}</span>
        ) : (
          <span className="text-zinc-400">Project</span>
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
            placeholder="Search projects..."
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
              Remove from project
            </button>
          )}

          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-400">No projects found</p>
            ) : (
              filtered.map(project => (
                <button
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    project.id === value
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'text-zinc-700 dark:text-zinc-300',
                  )}
                  key={project.id}
                  onClick={() => handleSelect(project.id)}
                  type="button"
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px]"
                    style={{
                      backgroundColor: `${project.color}20`,
                      color: project.color,
                    }}
                  >
                    {project.icon ?? ''}
                  </span>
                  <span className="truncate">{project.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});
