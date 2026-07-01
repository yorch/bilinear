'use client';

import { Target, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
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
  open,
  onClose,
}: ProjectSelectProps) {
  const { projectStore } = useStore();
  const projects = projectStore.all;
  const current = value ? projectStore.findById(value) : null;

  return (
    <SearchableSelectPopover
      clearLabel={
        <>
          <X className="h-3 w-3" />
          Remove from project
        </>
      }
      emptyText="No projects found"
      getKey={project => project.id}
      isSelected={project => project.id === value}
      items={projects}
      matchesSearch={(project, search) => project.name.toLowerCase().includes(search.toLowerCase())}
      onClear={value ? () => onChange(null) : undefined}
      onClose={onClose}
      onSelect={project => onChange(project.id)}
      open={open}
      renderItem={project => (
        <>
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
        </>
      )}
      searchPlaceholder="Search projects..."
      triggerChildren={
        <>
          <Target className="h-3 w-3" />
          {current ? (
            <span className="max-w-[100px] truncate">{current.name}</span>
          ) : (
            <span className="text-zinc-400">Project</span>
          )}
        </>
      }
      triggerTitle="Set project (Shift+P)"
    />
  );
});
