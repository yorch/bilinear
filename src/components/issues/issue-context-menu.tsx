'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface IssueContextMenuProps {
  issueId: string;
  identifier: string;
  title: string;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  separator?: false;
}

interface MenuSeparator {
  separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

export function IssueContextMenu({
  issueId,
  identifier,
  title,
  x,
  y,
  onClose,
  onOpen,
  onArchive,
  onDelete,
}: IssueContextMenuProps) {
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Build the issue URL for clipboard operations
  const issueUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${workspaceKey}/issue/${issueId}`
      : '';

  const items: MenuEntry[] = [
    {
      label: 'Open issue',
      onClick: () => { onOpen(); onClose(); },
    },
    {
      label: 'Open in new tab',
      onClick: () => {
        window.open(`/${workspaceKey}/issue/${issueId}`, '_blank');
        onClose();
      },
    },
    { separator: true },
    {
      label: 'Copy issue ID',
      onClick: () => {
        navigator.clipboard.writeText(identifier).catch(() => undefined);
        onClose();
      },
    },
    {
      label: 'Copy issue URL',
      onClick: () => {
        navigator.clipboard.writeText(issueUrl).catch(() => undefined);
        onClose();
      },
    },
    { separator: true },
    {
      danger: false,
      label: 'Archive',
      onClick: () => { onArchive(); onClose(); },
    },
    {
      danger: true,
      label: 'Delete',
      onClick: () => { onDelete(); onClose(); },
    },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${title}`}
      style={{
        left: x,
        position: 'fixed',
        top: y,
        zIndex: 9999,
      }}
      className="min-w-[200px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {items.map((entry, i) => {
        if ('separator' in entry && entry.separator) {
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: separator items have no stable id
              key={`sep-${i}`}
              className="my-1 border-t border-zinc-100 dark:border-zinc-800"
            />
          );
        }
        const item = entry as MenuItem;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: menu items are static
            key={i}
            type="button"
            role="menuitem"
            onClick={item.onClick}
            className={cn(
              'flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
              item.danger && 'text-red-600 dark:text-red-400',
            )}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <kbd className="ml-4 text-[10px] text-zinc-400">{item.shortcut}</kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
