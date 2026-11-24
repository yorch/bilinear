'use client';

import { RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { SCALE_OPTIONS } from '@/components/properties/estimate-picker';
import { POPOVER_ITEM_CLASS } from '@/components/ui/select-popover';
import { useIssueCreate } from '@/hooks/use-issue-create';
import { useTranslations } from '@/hooks/use-translations';
import { getCycleDisplayName } from '@/lib/cycle-utils';
import type { DBIssue } from '@/lib/db';
import { collectDescendantIds } from '@/lib/issue-hierarchy';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import { getDueDatePresets } from '../properties/due-date-presets';

/** What every context-menu panel needs: the patch writer and a way to dismiss. */
interface PanelProps {
  issue: DBIssue;
  onClose: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
}

const CURRENT = 'bg-accent/50';

export const ProjectPanel = observer(function ProjectPanel({
  issue,
  onClose,
  onUpdate,
}: PanelProps) {
  const t = useTranslations();
  const { projectStore } = useStore();
  return (
    <>
      <button
        className={cn(POPOVER_ITEM_CLASS, !issue.projectId && CURRENT)}
        onClick={() => {
          // A milestone belongs to its project, so leaving a project clears it.
          onUpdate({ projectId: null, projectMilestoneId: null });
          onClose();
        }}
        type="button"
      >
        {t('properties.project.removeFromProject')}
      </button>
      {projectStore.all.map(p => (
        <button
          className={cn(POPOVER_ITEM_CLASS, p.id === issue.projectId && CURRENT)}
          key={p.id}
          onClick={() => {
            onUpdate({ projectId: p.id, projectMilestoneId: null });
            onClose();
          }}
          type="button"
        >
          <span className="truncate">{p.name}</span>
        </button>
      ))}
    </>
  );
});

export const CyclePanel = observer(function CyclePanel({ issue, onClose, onUpdate }: PanelProps) {
  const t = useTranslations();
  const { cycleStore } = useStore();
  const cycles = cycleStore.findByTeamId(issue.teamId);
  return (
    <>
      <button
        className={cn(POPOVER_ITEM_CLASS, !issue.cycleId && CURRENT)}
        onClick={() => {
          onUpdate({ cycleId: null });
          onClose();
        }}
        type="button"
      >
        {t('properties.cycle.removeFromCycle')}
      </button>
      {cycles.map(c => (
        <button
          className={cn(POPOVER_ITEM_CLASS, c.id === issue.cycleId && CURRENT)}
          key={c.id}
          onClick={() => {
            onUpdate({ cycleId: c.id });
            onClose();
          }}
          type="button"
        >
          <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{getCycleDisplayName(c)}</span>
        </button>
      ))}
    </>
  );
});

const PRESET_LABEL: Record<ReturnType<typeof getDueDatePresets>[number]['key'], string> = {
  endOfWeek: 'properties.dueDate.endOfWeek',
  nextWeek: 'properties.dueDate.nextWeek',
  today: 'properties.dueDate.today',
  tomorrow: 'properties.dueDate.tomorrow',
};

export function DueDatePanel({ issue, onClose, onUpdate }: PanelProps) {
  const t = useTranslations();
  return (
    <>
      {getDueDatePresets().map(preset => (
        <button
          className={cn(POPOVER_ITEM_CLASS, issue.dueDate?.slice(0, 10) === preset.date && CURRENT)}
          key={preset.key}
          onClick={() => {
            onUpdate({ dueDate: preset.date });
            onClose();
          }}
          type="button"
        >
          <span className="flex-1 text-left">{t(PRESET_LABEL[preset.key])}</span>
          <span className="font-mono text-xs text-muted-foreground">{preset.date}</span>
        </button>
      ))}
      <label className="flex flex-col gap-1 px-3 py-1.5 text-xs text-muted-foreground">
        {t('properties.dueDate.orPickDate')}
        <input
          aria-label={t('properties.dueDate.orPickDate')}
          className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
          defaultValue={issue.dueDate?.slice(0, 10) ?? ''}
          onChange={e => {
            if (e.target.value) {
              onUpdate({ dueDate: e.target.value });
              onClose();
            }
          }}
          type="date"
        />
      </label>
      {issue.dueDate && (
        <button
          className={POPOVER_ITEM_CLASS}
          onClick={() => {
            onUpdate({ dueDate: null });
            onClose();
          }}
          type="button"
        >
          {t('properties.dueDate.clearDate')}
        </button>
      )}
    </>
  );
}

export const EstimatePanel = observer(function EstimatePanel({
  issue,
  onClose,
  onUpdate,
}: PanelProps) {
  const t = useTranslations();
  const { teamStore } = useStore();
  const estimationType = teamStore.findById(issue.teamId)?.issueEstimationType ?? 'notUsed';
  const scale = SCALE_OPTIONS[estimationType] ?? [];
  return (
    <>
      <button
        className={cn(POPOVER_ITEM_CLASS, issue.estimate == null && CURRENT)}
        onClick={() => {
          onUpdate({ estimate: null });
          onClose();
        }}
        type="button"
      >
        {t('properties.estimate.noEstimate')}
      </button>
      {scale.map(opt => (
        <button
          className={cn(POPOVER_ITEM_CLASS, issue.estimate === opt.value && CURRENT)}
          key={opt.value}
          onClick={() => {
            onUpdate({ estimate: opt.value });
            onClose();
          }}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </>
  );
});

/** Teams the issue can move to — every team but its own. */
export const TeamPanel = observer(function TeamPanel({ issue, onClose, onUpdate }: PanelProps) {
  const { teamStore } = useStore();
  const teams = teamStore.all
    .filter(team => team.id !== issue.teamId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {teams.map(team => (
        <button
          className={POPOVER_ITEM_CLASS}
          key={team.id}
          onClick={() => {
            onUpdate({ teamId: team.id });
            onClose();
          }}
          type="button"
        >
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{team.key}</span>
          <span className="truncate">{team.name}</span>
        </button>
      ))}
    </>
  );
});

interface IssueSearchPanelProps {
  excludeIds?: ReadonlySet<string>;
  onClose: () => void;
  onSelect: (picked: DBIssue) => void;
}

/** Inline search-and-pick list for the "Set parent…" / "Mark as duplicate…" panels. */
export const IssueSearchPanel = observer(function IssueSearchPanel({
  excludeIds,
  onClose,
  onSelect,
}: IssueSearchPanelProps) {
  const t = useTranslations();
  const { issueStore } = useStore();
  const [query, setQuery] = useState('');
  const results = issueStore
    .search(query, 50)
    .filter(i => !excludeIds?.has(i.id))
    .slice(0, 20);
  return (
    <>
      <div className="px-2 pb-1">
        <input
          aria-label={t('issues.pickerSearchPlaceholder')}
          // biome-ignore lint/a11y/noAutofocus: the panel opens for the sole purpose of searching
          autoFocus
          className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            // The menu's roving-focus handler owns the arrows; typing is ours.
            e.stopPropagation();
            if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder={t('issues.pickerSearchPlaceholder')}
          value={query}
        />
      </div>
      {results.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('issues.pickerNoIssuesFound')}</p>
      ) : (
        results.map(issue => (
          <button
            className={POPOVER_ITEM_CLASS}
            key={issue.id}
            onClick={() => {
              onSelect(issue);
              onClose();
            }}
            type="button"
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {issue.identifier}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{issue.title}</span>
          </button>
        ))
      )}
    </>
  );
});

/** Descendants-and-self of `issueId`: the set a parent picker must hide. */
export function useParentExclusions(issueId: string): ReadonlySet<string> {
  const { issueStore } = useStore();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the reactive trigger per repo convention
  return useMemo(() => {
    const ids = collectDescendantIds(issueStore.pool.values(), issueId);
    ids.add(issueId);
    return ids;
  }, [issueId, issueStore.pool.size]);
}

/** Title box that creates a sub-issue inheriting the parent's project and cycle. */
export const SubIssuePanel = observer(function SubIssuePanel({
  issue,
  onClose,
}: Pick<PanelProps, 'issue' | 'onClose'>) {
  const t = useTranslations();
  const { teamStore, workflowStateStore } = useStore();
  const create = useIssueCreate(
    teamStore.findById(issue.teamId),
    workflowStateStore.findByTeamId(issue.teamId),
  );
  const [title, setTitle] = useState('');
  return (
    <form
      className="px-2 pb-1"
      onSubmit={e => {
        e.preventDefault();
        if (!title.trim()) {
          return;
        }
        void create({
          cycleId: issue.cycleId ?? undefined,
          labelIds: [],
          parentId: issue.id,
          priority: 0,
          projectId: issue.projectId ?? undefined,
          title: title.trim(),
        });
        onClose();
      }}
    >
      <input
        aria-label={t('issueDetail.subIssues.titlePlaceholder')}
        // biome-ignore lint/a11y/noAutofocus: the panel opens for the sole purpose of naming the sub-issue
        autoFocus
        className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground"
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        placeholder={t('issueDetail.subIssues.titlePlaceholder')}
        value={title}
      />
    </form>
  );
});
