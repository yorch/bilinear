'use client';

import { ListChecks } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PriorityIcon, priorityLabelKey } from '@/components/properties/priority-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useTranslations } from '@/hooks/use-translations';
import type { ColumnKey } from '@/hooks/use-visible-columns';
import type { DBCustomFieldDefinition } from '@/lib/db';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { BulkActionBar } from './bulk-action-bar';
import { GroupSection } from './group-section';
import { IssueContextMenu } from './issue-context-menu';
import type { IssueRowData, OpenProperty } from './issue-row';
import { IssueRow } from './issue-row';
import { drawnIdsOf, getVisualOrder, setVisualOrder } from './visual-order';

/** How the list is sectioned. `none` renders one flat, headerless list. */
export type ListGroupBy = 'status' | 'assignee' | 'priority' | 'none';

interface IssueListViewProps {
  customFields?: DBCustomFieldDefinition[];
  /** The team's estimation scale; supplying it adds an Estimate action to the bulk bar. */
  estimationType?: string;
  getCustomFieldValue?: (issueId: string, definitionId: string) => unknown;
  /** Section the list by this property (default: status). */
  groupBy?: ListGroupBy;
  /** True when a filter is narrowing the list: an empty result is then "no match", not "no issues". */
  hasActiveFilters?: boolean;
  isColumnVisible?: (key: ColumnKey) => boolean;
  issues: IssueRowData[];
  labels: IssueLabel[];
  onArchive?: (id: string) => void;
  /** Bulk archive for the checked set; falls back to `onArchive` per id. */
  onArchiveMany?: (ids: string[]) => void;
  onBulkUpdate?: (ids: string[], patch: Record<string, unknown>) => void;
  onClearFilters?: () => void;
  onDelete?: (id: string) => void;
  onOpen: (id: string) => void;
  onPropertyClosed?: () => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  /** Which property popover to force-open on the selected issue (keyboard shortcut). */
  openProperty?: OpenProperty;
  selectedId: string | null;
  states: WorkflowState[];
  teamId?: string;
  users: IssueUser[];
}

interface Group {
  color: string;
  issues: IssueRowData[];
  key: string;
  leading?: React.ReactNode;
  name: string;
}

interface ContextMenuState {
  identifier: string;
  issueId: string;
  title: string;
  x: number;
  y: number;
}

export function IssueListView({
  estimationType,
  groupBy = 'status',
  hasActiveFilters,
  onClearFilters,
  issues,
  states,
  users,
  labels,
  teamId,
  selectedId,
  onSelect,
  onOpen,
  onUpdate,
  onArchive,
  onArchiveMany,
  onDelete,
  onBulkUpdate,
  openProperty,
  onPropertyClosed,
  isColumnVisible,
  customFields,
  getCustomFieldValue,
}: IssueListViewProps) {
  const t = useTranslations();
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const lastCheckedIdRef = useRef<string | null>(null);

  const issueIds = useMemo(() => issues.map(i => i.id).join(','), [issues]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: issueIds is a stable change signal; the effect resets selection when the visible issue set changes
  useEffect(() => {
    setCheckedIds(new Set());
    lastCheckedIdRef.current = null;
  }, [issueIds]);

  const selectAll = () => setCheckedIds(new Set(issues.map(i => i.id)));

  useHotkeys(['meta+a', 'ctrl+a'], selectAll, { enabled: Boolean(onBulkUpdate) }, [
    issues,
    onBulkUpdate,
  ]);

  // X — check/uncheck the row under the cursor (the j/k selection).
  useHotkeys(
    'x',
    () => {
      if (selectedId) {
        handleCheck(selectedId, false);
      }
    },
    { enabled: Boolean(onBulkUpdate) && selectedId !== null },
    [selectedId, issues, onBulkUpdate],
  );

  // Escape — drop the checked set first, before the page's own Escape (which
  // clears the cursor / closes the detail panel) can see it: one Escape, one
  // surface. A capture listener rather than `useHotkeys`, because bubble-phase
  // listeners run in registration order and this one re-registers whenever the
  // checked set changes, which would put it behind the page's. An open popover
  // or menu keeps first claim on the key.
  useEffect(() => {
    if (checkedIds.size === 0) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest('input, textarea, [contenteditable="true"], dialog, [role="menu"]') ||
        document.querySelector('[aria-haspopup][aria-expanded="true"]') ||
        ctxMenu
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setCheckedIds(new Set());
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [checkedIds.size, ctxMenu]);

  // Shift+F10 / the Menu key — open the context menu for the cursor row,
  // anchored to the row, for keyboard users who have no right-click.
  useHotkeys(
    ['shift+f10', 'contextmenu'],
    () => {
      const issue = issues.find(i => i.id === selectedId);
      if (!issue) {
        return;
      }
      const rowEl = document.querySelector<HTMLElement>(
        `[data-testid="issue-row"][data-issue-id="${CSS.escape(issue.id)}"]`,
      );
      const rect = rowEl?.getBoundingClientRect();
      setCtxMenu({
        identifier: issue.identifier,
        issueId: issue.id,
        title: issue.title,
        x: (rect?.left ?? 0) + 48,
        y: (rect?.bottom ?? 0) - 4,
      });
    },
    { enabled: selectedId !== null },
    [selectedId, issues],
  );

  function visualIds(): string[] {
    const published = getVisualOrder();
    return published ?? issues.map(i => i.id);
  }

  function handleCheck(issueId: string, shiftKey: boolean) {
    if (!onBulkUpdate) {
      return;
    }
    // Index into the order rows are DRAWN in (grouped), not the `issues` array:
    // under any non-status grouping the two differ and a range would sweep up
    // rows from other groups.
    const order = visualIds();
    const currentIndex = order.indexOf(issueId);
    // `anchor` is read BEFORE setCheckedIds, not inside the updater.
    //
    // A `setState(prev => …)` updater does not run synchronously — React defers it
    // to the next render, by which point the `lastCheckedIndexRef.current =
    // currentIndex` line below has already executed. Reading the ref inside the
    // updater therefore always saw `currentIndex`, so `lo === hi` and a
    // shift-click extended the selection by exactly one row: itself. Together with
    // the modifier never arriving at all (see IssueRow), that is both halves of
    // why shift-range selection has never worked in this app.
    const anchor = lastCheckedIdRef.current ? order.indexOf(lastCheckedIdRef.current) : -1;
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (shiftKey && anchor >= 0) {
        const lo = Math.min(anchor, currentIndex);
        const hi = Math.max(anchor, currentIndex);
        const willCheck = !prev.has(issueId);
        for (let idx = lo; idx <= hi; idx++) {
          const id = order[idx];
          if (id) {
            if (willCheck) {
              next.add(id);
            } else {
              next.delete(id);
            }
          }
        }
      } else if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
    lastCheckedIdRef.current = issueId;
  }

  const groups = buildGroups(issues, groupBy, { states, t, users });
  const drawnIds = drawnIdsOf(groups, collapsedGroups, groupBy === 'none');
  const drawnKey = drawnIds.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawnKey is the change signal for drawnIds
  useEffect(() => {
    setVisualOrder(drawnIds);
    return () => setVisualOrder(null);
  }, [drawnKey]);

  if (issues.length === 0) {
    if (hasActiveFilters) {
      return (
        <EmptyState
          action={
            onClearFilters ? (
              <Button onClick={onClearFilters} size="sm" type="button" variant="outline">
                {t('issues.clearFilters')}
              </Button>
            ) : undefined
          }
          className="flex-1"
          description={t('issues.noIssuesMatchFiltersDescription')}
          icon={<ListChecks className="h-5 w-5" />}
          testId="empty-state"
          title={t('issues.noIssuesMatchFilters')}
        />
      );
    }
    return (
      <EmptyState
        className="flex-1"
        description={
          <>
            {t('issues.noIssuesFoundPrefix')}{' '}
            <kbd className="mx-0.5 rounded border border-border bg-surface-sunken px-1 font-mono text-[11px]">
              C
            </kbd>{' '}
            {t('issues.noIssuesFoundSuffix')}
          </>
        }
        icon={<ListChecks className="h-5 w-5" />}
        testId="empty-state"
        title={t('issues.noIssues')}
      />
    );
  }

  return (
    <div className="flex flex-col" data-testid="issue-list-view">
      {groups.map(({ color, key, leading, name, issues: groupIssues }) => (
        <GroupSection
          collapsed={collapsedGroups.has(key)}
          color={color}
          count={groupIssues.length}
          getKey={item => (item as IssueRowData).id}
          hideHeader={groupBy === 'none'}
          items={groupIssues}
          key={key}
          leading={leading}
          name={name}
          onCollapsedChange={c =>
            setCollapsedGroups(prev => {
              const next = new Set(prev);
              if (c) {
                next.add(key);
              } else {
                next.delete(key);
              }
              return next;
            })
          }
          renderItem={(item, _idx) => {
            const issue = item as IssueRowData;
            return (
              <IssueRow
                allLabels={labels}
                checked={checkedIds.has(issue.id)}
                customFields={customFields}
                getCustomFieldValue={
                  getCustomFieldValue ? defId => getCustomFieldValue(issue.id, defId) : undefined
                }
                isColumnVisible={isColumnVisible}
                issue={issue}
                key={issue.id}
                onCheck={
                  onBulkUpdate
                    ? shiftKey => {
                        handleCheck(issue.id, shiftKey);
                        onSelect(issue.id);
                      }
                    : undefined
                }
                onContextMenu={e => {
                  e.preventDefault();
                  setCtxMenu({
                    identifier: issue.identifier,
                    issueId: issue.id,
                    title: issue.title,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                onOpen={() => onOpen(issue.id)}
                onPropertyClosed={onPropertyClosed}
                onSelect={() => onSelect(issue.id)}
                onUpdate={onUpdate}
                openProperty={issue.id === selectedId ? openProperty : null}
                selected={issue.id === selectedId}
                states={states}
                teamId={teamId}
                users={users}
              />
            );
          }}
        />
      ))}

      {ctxMenu &&
        (() => {
          const ctxIssue = issues.find(i => i.id === ctxMenu.issueId);
          return (
            <IssueContextMenu
              currentAssigneeId={ctxIssue?.assigneeId}
              currentLabelIds={ctxIssue?.labels.map(l => l.id)}
              currentPriority={ctxIssue?.priority}
              currentStateId={ctxIssue?.stateId}
              identifier={ctxMenu.identifier}
              issueId={ctxMenu.issueId}
              labels={labels}
              onArchive={onArchive ? () => onArchive(ctxMenu.issueId) : undefined}
              onClose={() => setCtxMenu(null)}
              onDelete={onDelete ? () => onDelete(ctxMenu.issueId) : undefined}
              onOpen={() => onOpen(ctxMenu.issueId)}
              onUpdate={patch => onUpdate(ctxMenu.issueId, patch)}
              states={states}
              title={ctxMenu.title}
              users={users}
              x={ctxMenu.x}
              y={ctxMenu.y}
            />
          );
        })()}

      {onBulkUpdate && checkedIds.size > 0 && (
        <BulkActionBar
          count={checkedIds.size}
          estimationType={estimationType}
          labels={labels}
          onArchive={
            onArchiveMany || onArchive
              ? () => {
                  const ids = [...checkedIds];
                  if (onArchiveMany) {
                    onArchiveMany(ids);
                  } else {
                    for (const id of ids) {
                      onArchive?.(id);
                    }
                  }
                  setCheckedIds(new Set());
                }
              : undefined
          }
          onClear={() => setCheckedIds(new Set())}
          onSelectAll={selectAll}
          onUpdate={patch => {
            onBulkUpdate([...checkedIds], patch);
            setCheckedIds(new Set());
          }}
          states={states}
          totalCount={issues.length}
          users={users}
        />
      )}
    </div>
  );
}

/**
 * Partition the (already ordered) issues into the sections the list renders.
 * Order within a section is the caller's order; only the sections are ordered
 * here (workflow position, assignee name, priority urgency).
 */
function buildGroups(
  issues: IssueRowData[],
  groupBy: ListGroupBy,
  ctx: { states: WorkflowState[]; t: (key: string) => string; users: IssueUser[] },
): Group[] {
  const { states, t, users } = ctx;
  const mutedColor = 'var(--muted-foreground)';

  if (groupBy === 'none') {
    return [{ color: mutedColor, issues, key: '__all__', name: t('issues.issuesGroupName') }];
  }

  if (groupBy === 'assignee') {
    const named = [...users]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map<Group>(u => ({
        color: mutedColor,
        issues: issues.filter(i => i.assigneeId === u.id),
        key: u.id,
        leading: <UserAvatar user={u} />,
        name: u.displayName,
      }));
    const known = new Set(users.map(u => u.id));
    const unassigned: Group = {
      color: mutedColor,
      issues: issues.filter(i => !i.assigneeId || !known.has(i.assigneeId)),
      key: '__unassigned__',
      name: t('issues.unassigned'),
    };
    return [...named, unassigned].filter(g => g.issues.length > 0);
  }

  if (groupBy === 'priority') {
    // Urgent first, "No priority" last — numeric order would put 0 on top.
    return [1, 2, 3, 4, 0]
      .map<Group>(p => ({
        color: mutedColor,
        issues: issues.filter(i => i.priority === p),
        key: `priority-${p}`,
        leading: <PriorityIcon className="h-3.5 w-3.5" priority={p} />,
        name: t(priorityLabelKey(p)),
      }))
      .filter(g => g.issues.length > 0);
  }

  const stateIds = new Set(states.map(s => s.id));
  const groups = states
    .map<Group>(state => ({
      color: state.color,
      issues: issues.filter(i => i.stateId === state.id),
      key: state.id,
      name: state.name,
    }))
    .filter(g => g.issues.length > 0);

  // Issues whose stateId doesn't match any loaded state (e.g. stale cache)
  const orphaned = issues.filter(i => !stateIds.has(i.stateId));
  if (orphaned.length > 0 && groups.length === 0) {
    // All issues are orphaned — show them in a flat list rather than hiding them
    groups.push({
      color: mutedColor,
      issues: orphaned,
      key: '__ungrouped__',
      name: t('issues.issuesGroupName'),
    });
  }
  return groups;
}
