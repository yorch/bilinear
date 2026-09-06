'use client';

import { ArrowLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { LabelDot } from '@/components/properties/label-select';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { StatusDot } from '@/components/properties/status-select';
import { ColorDot } from '@/components/ui/color-dot';
import { POPOVER_ITEM_CLASS } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useFavoriteToggle } from '@/hooks/use-favorite-toggle';
import { useFormatters } from '@/hooks/use-formatters';
import { useIssueSnooze } from '@/hooks/use-issue-snooze';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import { getBranchName, getPriorityConfig, PRIORITY_OPTIONS } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { getSnoozePresets, isIssueSnoozed, snoozeUntilDate } from './snooze-presets';

type SubMenu = 'root' | 'status' | 'priority' | 'assignee' | 'label' | 'snooze';

interface IssueContextMenuProps {
  currentAssigneeId?: string | null;
  currentLabelIds?: string[];
  currentPriority?: number;
  currentStateId?: string;
  identifier: string;
  issueId: string;
  labels?: IssueLabel[];
  /** Omit on surfaces that cannot archive — the item is hidden, never a no-op. */
  onArchive?: () => void;
  onClose: () => void;
  /** Omit on surfaces that cannot delete — the item is hidden, never a no-op. */
  onDelete?: () => void;
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

export const IssueContextMenu = observer(function IssueContextMenu({
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
  const { formatDate } = useFormatters();
  const { issueStore } = useStore();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<SubMenu>('root');
  const { isFavorite, toggle: toggleFavorite } = useFavoriteToggle('Issue', issueId);
  const { snooze, unsnooze } = useIssueSnooze();
  const snoozed = isIssueSnoozed(issueStore.findById(issueId)?.snoozedUntilAt);
  const snoozePresets = getSnoozePresets();

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
      label: isFavorite ? t('nav.removeFromFavorites') : t('favorites.addToFavorites'),
      onClick: () => {
        void toggleFavorite();
        onClose();
      },
    },
    snoozed
      ? {
          label: t('issues.snooze.unsnooze'),
          onClick: () => {
            void unsnooze(issueId);
            onClose();
          },
        }
      : {
          label: t('issues.snooze.snooze'),
          onClick: () => setSubmenu('snooze'),
        },
    ...(onArchive || onDelete ? ([{ separator: true }] as MenuEntry[]) : []),
    ...(onArchive
      ? ([
          {
            danger: false,
            label: t('issues.archive'),
            onClick: () => {
              onArchive();
              onClose();
            },
          },
        ] as MenuEntry[])
      : []),
    ...(onDelete
      ? ([
          {
            danger: true,
            label: t('common.delete'),
            onClick: () => {
              onDelete();
              onClose();
            },
          },
        ] as MenuEntry[])
      : []),
  ];

  const submenuTitleKey: Record<Exclude<SubMenu, 'root'>, string> = {
    assignee: 'commandPalette.submenu.setAssignee',
    label: 'commandPalette.submenu.setLabel',
    priority: 'commandPalette.submenu.setPriority',
    snooze: 'issues.snooze.snooze',
    status: 'commandPalette.submenu.setStatus',
  };

  const presetLabelKey: Record<(typeof snoozePresets)[number]['key'], string> = {
    nextWeek: 'issues.snooze.nextWeek',
    tomorrow: 'issues.snooze.tomorrow',
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
                  className={cn(POPOVER_ITEM_CLASS, s.id === currentStateId && 'bg-accent/50')}
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
                    className={cn(POPOVER_ITEM_CLASS, value === currentPriority && 'bg-accent/50')}
                    key={p.value}
                    onClick={() => {
                      onUpdate?.({ priority: value });
                      onClose();
                    }}
                    type="button"
                  >
                    <ColorDot color={cfg.color} size="sm" />
                    <span>{t(priorityLabelKey(value))}</span>
                  </button>
                );
              })}
            {submenu === 'assignee' && (
              <>
                <button
                  className={cn(POPOVER_ITEM_CLASS, !currentAssigneeId && 'bg-accent/50')}
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
                    className={cn(POPOVER_ITEM_CLASS, u.id === currentAssigneeId && 'bg-accent/50')}
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
            {submenu === 'snooze' && (
              <>
                {snoozePresets.map(preset => (
                  <button
                    className={POPOVER_ITEM_CLASS}
                    key={preset.key}
                    onClick={() => {
                      void snooze(issueId, preset.until);
                      onClose();
                    }}
                    type="button"
                  >
                    <span className="flex-1 text-left">{t(presetLabelKey[preset.key])}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(preset.until, { day: 'numeric', month: 'short' })}
                    </span>
                  </button>
                ))}
                <label className="flex flex-col gap-1 px-3 py-1.5 text-xs text-muted-foreground">
                  {t('issues.snooze.customDate')}
                  <input
                    aria-label={t('issues.snooze.customDate')}
                    className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
                    onChange={e => {
                      const until = snoozeUntilDate(e.target.value);
                      if (until) {
                        void snooze(issueId, until);
                        onClose();
                      }
                    }}
                    type="date"
                  />
                </label>
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
                      POPOVER_ITEM_CLASS,
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
});
