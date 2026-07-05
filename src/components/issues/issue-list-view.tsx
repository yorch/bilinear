'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

interface IssueListViewProps {
  customFields?: DBCustomFieldDefinition[];
  getCustomFieldValue?: (issueId: string, definitionId: string) => unknown;
  isColumnVisible?: (key: ColumnKey) => boolean;
  issues: IssueRowData[];
  labels: IssueLabel[];
  onArchive?: (id: string) => void;
  onBulkUpdate?: (ids: string[], patch: Record<string, unknown>) => void;
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
  issues: IssueRowData[];
  state: WorkflowState;
}

interface ContextMenuState {
  identifier: string;
  issueId: string;
  title: string;
  x: number;
  y: number;
}

export function IssueListView({
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
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const lastCheckedIndexRef = useRef<number>(-1);

  const issueIds = useMemo(() => issues.map(i => i.id).join(','), [issues]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: issueIds is a stable change signal; the effect resets selection when the visible issue set changes
  useEffect(() => {
    setCheckedIds(new Set());
    lastCheckedIndexRef.current = -1;
  }, [issueIds]);

  const selectAll = () => setCheckedIds(new Set(issues.map(i => i.id)));

  useHotkeys(['meta+a', 'ctrl+a'], selectAll, { enabled: Boolean(onBulkUpdate) }, [
    issues,
    onBulkUpdate,
  ]);

  function handleCheck(issueId: string, shiftKey: boolean) {
    if (!onBulkUpdate) {
      return;
    }
    const currentIndex = issues.findIndex(i => i.id === issueId);
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndexRef.current >= 0) {
        const lo = Math.min(lastCheckedIndexRef.current, currentIndex);
        const hi = Math.max(lastCheckedIndexRef.current, currentIndex);
        const willCheck = !prev.has(issueId);
        for (let idx = lo; idx <= hi; idx++) {
          const id = issues[idx]?.id;
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
    lastCheckedIndexRef.current = currentIndex;
  }

  // Group issues by state, preserving workflow state order
  const stateIds = new Set(states.map(s => s.id));
  const groups: Group[] = states
    .map(state => ({
      issues: issues.filter(i => i.stateId === state.id),
      state,
    }))
    .filter(g => g.issues.length > 0);

  // Issues whose stateId doesn't match any loaded state (e.g. stale cache)
  const ungrouped = issues.filter(i => !stateIds.has(i.stateId));
  if (ungrouped.length > 0 && groups.length === 0) {
    // All issues are ungrouped — show them in a flat list rather than hiding them
    groups.push({
      issues: ungrouped,
      state: {
        color: 'var(--muted-foreground)',
        id: '__ungrouped__',
        name: t('issues.issuesGroupName'),
        type: 'backlog',
      },
    });
  }

  if (issues.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center py-20 text-sm text-zinc-400"
        data-testid="empty-state"
      >
        {t('issues.noIssuesFoundPrefix')}{' '}
        <kbd className="mx-1 rounded border px-1 font-mono text-xs">C</kbd>{' '}
        {t('issues.noIssuesFoundSuffix')}
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="issue-list-view">
      {groups.map(({ state, issues: groupIssues }) => (
        <GroupSection
          color={state.color}
          count={groupIssues.length}
          getKey={item => (item as IssueRowData).id}
          items={groupIssues}
          key={state.id}
          name={state.name}
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
              onArchive={() => onArchive?.(ctxMenu.issueId)}
              onClose={() => setCtxMenu(null)}
              onDelete={() => onDelete?.(ctxMenu.issueId)}
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
          labels={labels}
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
