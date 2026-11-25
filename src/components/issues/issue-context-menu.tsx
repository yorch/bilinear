'use client';

import { ArrowLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LabelDot } from '@/components/properties/label-select';
import { PriorityIcon, priorityLabelKey } from '@/components/properties/priority-icon';
import { StatusDot } from '@/components/properties/status-select';
import { POPOVER_ITEM_CLASS } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useFavoriteToggle } from '@/hooks/use-favorite-toggle';
import { useFormatters } from '@/hooks/use-formatters';
import { useIssueReminders } from '@/hooks/use-issue-reminders';
import { useIssueSnooze } from '@/hooks/use-issue-snooze';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import { getBranchName, PRIORITY_OPTIONS } from '@/lib/issue-utils';
import { toMarkdownLink } from '@/lib/markdown-link';
import { isRovingFocusKey, nextRovingIndex } from '@/lib/roving-focus';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import {
  CyclePanel,
  DueDatePanel,
  EstimatePanel,
  IssueSearchPanel,
  ProjectPanel,
  SubIssuePanel,
  TeamPanel,
  useParentExclusions,
} from './issue-context-submenus';
import { IssueReminderPanel } from './issue-reminder-panel';
import { getSnoozePresets, isIssueSnoozed, snoozeUntilDate } from './snooze-presets';

type SubMenu =
  | 'root'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'label'
  | 'remind'
  | 'snooze'
  | 'project'
  | 'cycle'
  | 'dueDate'
  | 'estimate'
  | 'parent'
  | 'subIssue'
  | 'duplicate'
  | 'team';

const CREATE_DUPLICATE_RELATION = `
  mutation MarkDuplicate($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      lastSyncId
    }
  }
`;

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
  /** Omit where the issue is already open (detail page / panel) — the item is hidden. */
  onOpen?: () => void;
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
  const { reminderFor } = useIssueReminders();
  const hasReminder = reminderFor(issueId) !== null;
  const snoozed = isIssueSnoozed(issueStore.findById(issueId)?.snoozedUntilAt);
  const snoozePresets = getSnoozePresets();
  const txQueue = useMemo(() => new TransactionQueue(), []);
  const { cycleStore, teamStore } = useStore();
  const issueRow = issueStore.findById(issueId);
  const parentExclusions = useParentExclusions(issueId);

  useOutsideClick(menuRef, onClose, true, true);

  // Opened at the pointer, which can be anywhere: measure the real menu and pull
  // it back inside the viewport (flip up/left rather than clip "Delete" off the
  // bottom edge). Re-measured per submenu because each has a different height.
  const [pos, setPos] = useState({ x, y });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `submenu` is the re-measure trigger — each panel has a different height
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) {
      return;
    }
    const margin = 8;
    const { height, width } = el.getBoundingClientRect();
    const maxX = window.innerWidth - width - margin;
    const maxY = window.innerHeight - height - margin;
    setPos({
      x: Math.max(margin, Math.min(x, maxX)),
      y: Math.max(margin, Math.min(y, maxY)),
    });
  }, [x, y, submenu]);

  // Keyboard: focus lands inside the menu on open (and when a submenu swaps the
  // content), then Arrow/Home/End rove between the items.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `submenu` re-focuses the first item of the new panel
  useLayoutEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [submenu]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRovingFocusKey(e.key)) {
      return;
    }
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
    );
    if (buttons.length === 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[nextRovingIndex(e.key, current, buttons.length)]?.focus();
  };

  // Build the issue URL for clipboard operations
  const issueUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${workspaceKey}/issue/${issueId}`
      : '';

  const canQuickEdit = Boolean(onUpdate);

  // Clipboard writes reject without permission or focus; say so rather than
  // letting the menu close as if the copy had worked.
  const copyText = (text: string, successMessage?: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        if (successMessage) {
          toast.success(successMessage);
        }
      })
      .catch(() => toast.error(t('issueDetail.properties.copyFailed')));
  };

  const items: MenuEntry[] = [
    ...(onOpen
      ? ([
          {
            label: t('issues.openIssue'),
            onClick: () => {
              onOpen();
              onClose();
            },
          },
        ] as MenuEntry[])
      : []),
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
        copyText(issueUrl);
        onClose();
      },
    },
    {
      label: t('issues.copyAsMarkdown'),
      onClick: () => {
        copyText(toMarkdownLink(`${identifier} ${title}`, issueUrl), t('issues.markdownCopied'));
        onClose();
      },
    },
    {
      label: t('issues.copyBranchName'),
      onClick: () => {
        copyText(getBranchName(identifier, title));
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
          {
            label: t('commandPalette.submenu.setProject'),
            onClick: () => setSubmenu('project'),
          },
          ...(issueRow && cycleStore.findByTeamId(issueRow.teamId).length > 0
            ? ([
                {
                  label: t('commandPalette.submenu.setCycle'),
                  onClick: () => setSubmenu('cycle'),
                },
              ] as MenuEntry[])
            : []),
          {
            label: t('commandPalette.submenu.setDueDate'),
            onClick: () => setSubmenu('dueDate'),
          },
          ...(issueRow &&
          (teamStore.findById(issueRow.teamId)?.issueEstimationType ?? 'notUsed') !== 'notUsed'
            ? ([
                {
                  label: t('commandPalette.submenu.setEstimate'),
                  onClick: () => setSubmenu('estimate'),
                },
              ] as MenuEntry[])
            : []),
          { separator: true },
          {
            label: t('commandPalette.submenu.setParent'),
            onClick: () => setSubmenu('parent'),
          },
          {
            label: t('commandPalette.submenu.addSubIssue'),
            onClick: () => setSubmenu('subIssue'),
          },
          {
            label: t('commandPalette.submenu.markDuplicate'),
            onClick: () => setSubmenu('duplicate'),
          },
          ...(teamStore.all.length > 1
            ? ([
                {
                  label: t('commandPalette.submenu.moveToTeam'),
                  onClick: () => setSubmenu('team'),
                },
              ] as MenuEntry[])
            : []),
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
    {
      label: hasReminder ? t('reminders.menuItemChange') : t('reminders.menuItem'),
      onClick: () => setSubmenu('remind'),
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
    cycle: 'commandPalette.submenu.setCycle',
    dueDate: 'commandPalette.submenu.setDueDate',
    duplicate: 'commandPalette.submenu.markDuplicate',
    estimate: 'commandPalette.submenu.setEstimate',
    label: 'commandPalette.submenu.setLabel',
    parent: 'commandPalette.submenu.setParent',
    priority: 'commandPalette.submenu.setPriority',
    project: 'commandPalette.submenu.setProject',
    remind: 'reminders.menuItem',
    snooze: 'issues.snooze.snooze',
    status: 'commandPalette.submenu.setStatus',
    subIssue: 'commandPalette.submenu.addSubIssue',
    team: 'commandPalette.submenu.moveToTeam',
  };

  // Mark as duplicate: record the relation and nothing else. The server's
  // issueRelationCreate already moves an open issue to the team's canceled
  // state (and leaves a completed/canceled one alone), then syncs the result
  // back. A second client-side state write would cancel a completed issue and
  // null its completedAt, and would leave it canceled if the relation failed.
  const markDuplicateOf = (original: { id: string; identifier: string }) => {
    txQueue.enqueue(
      CREATE_DUPLICATE_RELATION,
      { input: { issueId, relatedIssueId: original.id, type: 'duplicate' } },
      {
        onError: () => toast.error(t('issueDetail.relations.failedToCreate')),
        onSuccess: () =>
          toast.success(t('issues.markedDuplicateToast', { identifier: original.identifier })),
      },
    );
  };

  const presetLabelKey: Record<(typeof snoozePresets)[number]['key'], string> = {
    nextWeek: 'issues.snooze.nextWeek',
    tomorrow: 'issues.snooze.tomorrow',
  };

  return (
    <div
      aria-label={t('issues.actionsFor', { title })}
      className={cn(
        'max-h-[calc(100dvh-1rem)] min-w-[200px] overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-e2',
        // The reminder picker is too wide and tall for a pointer-anchored popover on a
        // phone (it covered the issue title and clipped its button): dock it as a
        // full-width bottom sheet. `!` beats the inline pointer position.
        submenu === 'remind' &&
          'max-md:!inset-x-0 max-md:!bottom-0 max-md:!left-0 max-md:!top-auto max-md:w-full max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom)]',
      )}
      onKeyDown={handleMenuKeyDown}
      ref={menuRef}
      role="menu"
      style={{
        left: pos.x,
        position: 'fixed',
        top: pos.y,
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
                'flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent focus-visible:bg-accent',
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
          <div
            className={cn(
              'overflow-y-auto',
              // Size to content: viewport-aware rather than a fixed 16rem clip.
              submenu === 'remind' ? 'max-h-[min(34rem,calc(100dvh-6rem))]' : 'max-h-64',
            )}
          >
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
                    {/* PriorityIcon, not a ColorDot: a dot encodes the level by
                        colour alone, so this menu disagreed with the icon on
                        every row it was opened from. */}
                    <PriorityIcon className="h-3.5 w-3.5" priority={value} />
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
            {submenu === 'remind' && <IssueReminderPanel issueId={issueId} onClose={onClose} />}
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
            {issueRow && submenu === 'project' && (
              <ProjectPanel
                issue={issueRow}
                onClose={onClose}
                onUpdate={patch => onUpdate?.(patch)}
              />
            )}
            {issueRow && submenu === 'cycle' && (
              <CyclePanel
                issue={issueRow}
                onClose={onClose}
                onUpdate={patch => onUpdate?.(patch)}
              />
            )}
            {issueRow && submenu === 'dueDate' && (
              <DueDatePanel
                issue={issueRow}
                onClose={onClose}
                onUpdate={patch => onUpdate?.(patch)}
              />
            )}
            {issueRow && submenu === 'estimate' && (
              <EstimatePanel
                issue={issueRow}
                onClose={onClose}
                onUpdate={patch => onUpdate?.(patch)}
              />
            )}
            {issueRow && submenu === 'team' && (
              <TeamPanel issue={issueRow} onClose={onClose} onUpdate={patch => onUpdate?.(patch)} />
            )}
            {issueRow && submenu === 'subIssue' && (
              <SubIssuePanel issue={issueRow} onClose={onClose} />
            )}
            {submenu === 'parent' && (
              <>
                {issueRow?.parentId && (
                  <button
                    className={POPOVER_ITEM_CLASS}
                    onClick={() => {
                      onUpdate?.({ parentId: null });
                      onClose();
                    }}
                    type="button"
                  >
                    {t('issueDetail.properties.removeParent')}
                  </button>
                )}
                <IssueSearchPanel
                  excludeIds={parentExclusions}
                  onClose={onClose}
                  onSelect={picked => onUpdate?.({ parentId: picked.id })}
                />
              </>
            )}
            {submenu === 'duplicate' && (
              <IssueSearchPanel
                excludeIds={new Set([issueId])}
                onClose={onClose}
                onSelect={markDuplicateOf}
              />
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
