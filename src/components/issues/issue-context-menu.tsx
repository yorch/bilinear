'use client';

import { ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { LabelDot } from '@/components/properties/label-select';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { StatusDot } from '@/components/properties/status-select';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import { getBranchName, getPriorityConfig, PRIORITY_OPTIONS } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

type SubMenu = 'root' | 'status' | 'priority' | 'assignee' | 'label';

interface IssueContextMenuProps {
  currentAssigneeId?: string | null;
  currentLabelIds?: string[];
  currentPriority?: number;
  currentStateId?: string;
  identifier: string;
  issueId: string;
  labels?: IssueLabel[];
  onArchive: () => void;
  onClose: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onUpdate?: (patch: Record<string, unknown>) => void;
  states?: WorkflowState[];
  title: string;
  users?: IssueUser[];
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
  onUpdate,
  states = [],
  users = [],
  labels = [],
  currentStateId,
  currentPriority,
  currentAssigneeId,
  currentLabelIds = [],
}: IssueContextMenuProps) {
  const t = useTranslations();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<SubMenu>('root');

  useOutsideClick(menuRef, onClose, true, true);

  // Build the issue URL for clipboard operations
  const issueUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${workspaceKey}/issue/${issueId}`
      : '';

  const canQuickEdit = Boolean(onUpdate);

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
    {
      label: t('issues.copyBranchName'),
      onClick: () => {
        navigator.clipboard.writeText(getBranchName(identifier, title)).catch(() => undefined);
        onClose();
      },
    },
    ...(canQuickEdit
      ? ([
          { separator: true },
          {
            label: t('commandPalette.submenu.setStatus'),
            onClick: () => setSubmenu('status'),
          },
          {
            label: t('commandPalette.submenu.setPriority'),
            onClick: () => setSubmenu('priority'),
          },
          {
            label: t('commandPalette.submenu.setAssignee'),
            onClick: () => setSubmenu('assignee'),
          },
          {
            label: t('commandPalette.submenu.setLabel'),
            onClick: () => setSubmenu('label'),
          },
        ] as MenuEntry[])
      : []),
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

  const submenuTitleKey: Record<Exclude<SubMenu, 'root'>, string> = {
    assignee: 'commandPalette.submenu.setAssignee',
    label: 'commandPalette.submenu.setLabel',
    priority: 'commandPalette.submenu.setPriority',
    status: 'commandPalette.submenu.setStatus',
  };

  return (
    <div
      aria-label={t('issues.actionsFor', { title })}
      className="min-w-[200px] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-e2"
      ref={menuRef}
      role="menu"
      style={{
        left: x,
        position: 'fixed',
        top: y,
        zIndex: 9999,
      }}
    >
      {submenu === 'root' ? (
        items.map((entry, i) => {
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
                item.danger && 'text-danger-subtle-foreground',
              )}
              key={item.label}
              onClick={item.onClick}
              role="menuitem"
              type="button"
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <kbd className="ml-4 text-[10px] text-muted-foreground">{item.shortcut}</kbd>
              )}
            </button>
          );
        })
      ) : (
        <>
          <button
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
            onClick={() => setSubmenu('root')}
            type="button"
          >
            <ArrowLeft className="h-3 w-3" />
            {t(submenuTitleKey[submenu])}
          </button>
          <div className="my-1 border-t border-border" />
          <div className="max-h-64 overflow-y-auto">
            {submenu === 'status' &&
              states.map(s => (
                <button
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                    s.id === currentStateId && 'bg-accent/50',
                  )}
                  key={s.id}
                  onClick={() => {
                    onUpdate?.({ stateId: s.id });
                    onClose();
                  }}
                  type="button"
                >
                  <StatusDot color={s.color} />
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            {submenu === 'priority' &&
              PRIORITY_OPTIONS.map(p => {
                const value = Number(p.value);
                const cfg = getPriorityConfig(value);
                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                      value === currentPriority && 'bg-accent/50',
                    )}
                    key={p.value}
                    onClick={() => {
                      onUpdate?.({ priority: value });
                      onClose();
                    }}
                    type="button"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: cfg.color }}
                    />
                    <span>{t(priorityLabelKey(value))}</span>
                  </button>
                );
              })}
            {submenu === 'assignee' && (
              <>
                <button
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                    !currentAssigneeId && 'bg-accent/50',
                  )}
                  onClick={() => {
                    onUpdate?.({ assigneeId: null });
                    onClose();
                  }}
                  type="button"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                    —
                  </span>
                  <span>{t('commandPalette.submenu.noAssignee')}</span>
                </button>
                {users.map(u => (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                      u.id === currentAssigneeId && 'bg-accent/50',
                    )}
                    key={u.id}
                    onClick={() => {
                      onUpdate?.({ assigneeId: u.id });
                      onClose();
                    }}
                    type="button"
                  >
                    <UserAvatar user={u} />
                    <span className="truncate">{u.displayName}</span>
                  </button>
                ))}
              </>
            )}
            {submenu === 'label' &&
              (labels.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {t('commandPalette.submenu.noOptions')}
                </p>
              ) : (
                labels.map(l => (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                      currentLabelIds.includes(l.id) && 'bg-accent/50',
                    )}
                    key={l.id}
                    onClick={() => {
                      const next = currentLabelIds.includes(l.id)
                        ? currentLabelIds.filter(id => id !== l.id)
                        : [...currentLabelIds, l.id];
                      onUpdate?.({ labelIds: next });
                      onClose();
                    }}
                    type="button"
                  >
                    <LabelDot color={l.color} />
                    <span className="truncate">{l.name}</span>
                  </button>
                ))
              ))}
          </div>
        </>
      )}
    </div>
  );
}
