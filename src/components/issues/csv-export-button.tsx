'use client';

import { Download } from 'lucide-react';
import { downloadCsv, rowsToCsv } from '@/lib/csv-export';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { toast } from '@/lib/toast';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

export interface CsvIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  estimate?: number | null;
  dueDate?: string | null;
  stateId: string;
  assigneeId?: string | null;
  creatorId?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  labels: IssueLabel[];
  createdAt?: string;
  updatedAt?: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export function CsvExportButton({
  issues,
  states,
  users,
  projectsById,
  cyclesById,
  customFields,
  getCustomFieldValue,
  stem,
}: {
  issues: CsvIssue[];
  states: WorkflowState[];
  users: IssueUser[];
  /** Pre-indexed lookups so we don't build a Map per cell. */
  projectsById: Map<string, { name: string }>;
  cyclesById: Map<string, { name: string | null; number: number }>;
  customFields?: DBCustomFieldDefinition[];
  getCustomFieldValue?: (issueId: string, definitionId: string) => unknown;
  /** Filename stem — ".csv" and a UTC date stamp are appended. */
  stem: string;
}) {
  const handleExport = () => {
    if (issues.length === 0) {
      toast.error('Nothing to export — apply different filters or add issues.');
      return;
    }

    const statesById = new Map(states.map(s => [s.id, s]));
    const usersById = new Map(users.map(u => [u.id, u]));

    const baseHeaders = [
      'ID',
      'Title',
      'Status',
      'Priority',
      'Assignee',
      'Labels',
      'Due date',
      'Estimate',
      'Cycle',
      'Project',
      'Created',
      'Updated',
    ];
    const customHeaders = (customFields ?? []).map(d => d.name);
    const headers = [...baseHeaders, ...customHeaders];

    const rows: unknown[][] = issues.map(issue => {
      const state = statesById.get(issue.stateId);
      const assignee = issue.assigneeId
        ? usersById.get(issue.assigneeId)
        : null;
      const cycle = issue.cycleId ? cyclesById.get(issue.cycleId) : null;
      const project = issue.projectId
        ? projectsById.get(issue.projectId)
        : null;

      const base: unknown[] = [
        issue.identifier,
        issue.title,
        state?.name ?? '',
        PRIORITY_LABELS[issue.priority] ?? String(issue.priority),
        assignee?.displayName ?? '',
        issue.labels.map(l => l.name),
        issue.dueDate ?? '',
        issue.estimate ?? '',
        cycle ? (cycle.name ?? `Cycle ${cycle.number}`) : '',
        project?.name ?? '',
        issue.createdAt ?? '',
        issue.updatedAt ?? '',
      ];

      const customCells = (customFields ?? []).map(def => {
        const raw = getCustomFieldValue?.(issue.id, def.id);
        if (raw === null || raw === undefined) {
          return '';
        }
        if (def.type === 'select') {
          return def.options?.find(o => o.value === raw)?.label ?? raw;
        }
        if (def.type === 'multi_select' && Array.isArray(raw)) {
          return raw.map(
            v => def.options?.find(o => o.value === v)?.label ?? v,
          );
        }
        return raw;
      });

      return [...base, ...customCells];
    });

    downloadCsv(stem, rowsToCsv(headers, rows));
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      aria-label="Export CSV"
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </button>
  );
}
