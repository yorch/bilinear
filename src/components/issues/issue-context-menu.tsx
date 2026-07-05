'use client';

import { useParams } from 'next/navigation';
import { useRef } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

interface IssueContextMenuProps {
  identifier: string;
  issueId: string;
  onArchive: () => void;
  onClose: () => void;
  onDelete: () => void;
  onOpen: () => void;
  title: string;
  x: number;
  y: number;
}

interface MenuItem {
  danger?: boolean;
  label: string;
  onClick: () => void;
  separator?: false;
  shortcut?: string;
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
  const t = useTranslations();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';
  const menuRef = useRef<HTMLDivElement>(null);

  useOutsideClick(menuRef, onClose, true, true);

  // Build the issue URL for clipboard operations
  const issueUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${workspaceKey}/issue/${issueId}`
      : '';

  const items: MenuEntry[] = [
    {
      label: t('issues.openIssue'),
      onClick: () => {
        onOpen();
        onClose();
      },
    },
    {
      label: t('issues.openInNewTab'),
      onClick: () => {
        window.open(`/${workspaceKey}/issue/${issueId}`, '_blank');
        onClose();
      },
    },
    { separator: true },
    {
      label: t('issues.copyIssueId'),
      onClick: () => {
        navigator.clipboard.writeText(identifier).catch(() => undefined);
        onClose();
      },
    },
    {
      label: t('issues.copyIssueUrl'),
      onClick: () => {
        navigator.clipboard.writeText(issueUrl).catch(() => undefined);
        onClose();
      },
    },
    { separator: true },
    {
      danger: false,
      label: t('issues.archive'),
      onClick: () => {
        onArchive();
        onClose();
      },
    },
    {
      danger: true,
      label: t('common.delete'),
      onClick: () => {
        onDelete();
        onClose();
      },
    },
  ];

  return (
    <div
      aria-label={t('issues.actionsFor', { title })}
      className="min-w-[200px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      ref={menuRef}
      role="menu"
      style={{
        left: x,
        position: 'fixed',
        top: y,
        zIndex: 9999,
      }}
    >
      {items.map((entry, i) => {
        if ('separator' in entry && entry.separator) {
          return (
            <div
              className="my-1 border-t border-border"
              // biome-ignore lint/suspicious/noArrayIndexKey: separator items have no stable id
              key={`sep-${i}`}
            />
          );
        }
        const item = entry as MenuItem;
        return (
          <button
            className={cn(
              'flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent',
              item.danger && 'text-red-600 dark:text-red-400',
            )}
            key={item.label}
            onClick={item.onClick}
            role="menuitem"
            type="button"
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd className="ml-4 text-[10px] text-zinc-400">{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
