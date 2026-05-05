'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

/**
 * Triage queue for a triage-enabled team. Issues created without an explicit
 * state on a triage-enabled team default to the triage state and surface here.
 *
 * Actions:
 *   - Accept   → move to a target workflow state (typically backlog)
 *   - Decline  → cancel the issue
 *   - Snooze   → hide from queue until a future timestamp
 *   - Mark dup → mark as duplicate of another issue and cancel
 */

const TRIAGE_ACCEPT_MUTATION = `
  mutation TriageAccept($issueId: ID!, $input: IssueTriageAcceptInput!) {
    issueTriageAccept(issueId: $issueId, input: $input) {
      success
      lastSyncId
      issue { id stateId triagedAt }
    }
  }
`;

const TRIAGE_DECLINE_MUTATION = `
  mutation TriageDecline($issueId: ID!) {
    issueTriageDecline(issueId: $issueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt }
    }
  }
`;

const TRIAGE_MARK_DUPLICATE_MUTATION = `
  mutation TriageMarkDuplicate($issueId: ID!, $canonicalIssueId: ID!) {
    issueTriageMarkDuplicate(issueId: $issueId, canonicalIssueId: $canonicalIssueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt }
    }
  }
`;

const TRIAGE_SNOOZE_MUTATION = `
  mutation TriageSnooze($issueId: ID!, $until: DateTime!) {
    issueTriageSnooze(issueId: $issueId, until: $until) {
      success
      lastSyncId
      issue { id snoozedUntilAt }
    }
  }
`;

const SNOOZE_PRESETS: Array<{ label: string; hours: number }> = [
  { hours: 4, label: '4 hours' },
  { hours: 24, label: '1 day' },
  { hours: 168, label: '1 week' },
];

/**
 * Click-to-open popover with preset items. Replaces an earlier
 * `group-hover:block` approach that was inaccessible on touch devices
 * and dismissed before the click could register on some browsers.
 */
function SnoozeButton({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (hours: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useOutsideClick(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        Snooze
      </button>
      {open ? (
        <div
          className="absolute right-0 z-10 mt-1 min-w-[120px] rounded border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          role="menu"
        >
          {SNOOZE_PRESETS.map(p => (
            <button
              className="block w-full px-3 py-1 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              key={p.hours}
              onClick={() => {
                setOpen(false);
                onSelect(p.hours);
              }}
              role="menuitem"
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TriagePage = observer(function TriagePage() {
  const { key: teamKey } = useParams<{ workspace: string; key: string }>();
  const { issueStore, teamStore, workflowStateStore, userStore, syncStore } = useStore();
  const [busyId, setBusyId] = useState<string | null>(null);

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  // The triage state for this team (if triage is enabled).
  const triageStateId = useMemo(() => {
    if (!teamId) {
      return null;
    }
    return workflowStateStore.findByTeamId(teamId).find(s => s.type === 'triage')?.id ?? null;
  }, [teamId, workflowStateStore]);

  // Default target state on accept: the team's first backlog state.
  const defaultTargetStateId = useMemo(() => {
    if (!teamId) {
      return null;
    }
    return workflowStateStore.findByTeamId(teamId).find(s => s.type === 'backlog')?.id ?? null;
  }, [teamId, workflowStateStore]);

  const queue = useMemo(() => {
    if (!teamId || !triageStateId) {
      return [];
    }
    const now = Date.now();
    return issueStore
      .findByTeamId(teamId)
      .filter(
        i =>
          i.stateId === triageStateId &&
          (!i.snoozedUntilAt || new Date(i.snoozedUntilAt).getTime() <= now),
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [teamId, triageStateId, issueStore]);

  /** Snapshot the issue so we can roll back optimistic edits on error. */
  const handleAccept = useCallback(
    async (issueId: string) => {
      if (!defaultTargetStateId) {
        return;
      }
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      // Optimistic: remove from triage queue immediately.
      issueStore.optimisticUpdate(issueId, { stateId: defaultTargetStateId });
      try {
        const res = await gql(TRIAGE_ACCEPT_MUTATION, {
          input: { stateId: defaultTargetStateId },
          issueId,
        });
        if (res.errors?.length) {
          throw new Error((res.errors[0] as { message?: string })?.message ?? 'Accept failed');
        }
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(err instanceof Error ? err.message : 'Failed to accept issue');
      } finally {
        setBusyId(null);
      }
    },
    [defaultTargetStateId, issueStore],
  );

  const handleDecline = useCallback(
    async (issueId: string) => {
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      // Optimistic: hide from queue while the request is in flight.
      // We mark with a synthetic snoozedUntilAt far in the future so the
      // queue filter excludes it; the real cancel arrives via WS.
      issueStore.optimisticUpdate(issueId, {
        snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      try {
        const res = await gql(TRIAGE_DECLINE_MUTATION, { issueId });
        if (res.errors?.length) {
          throw new Error((res.errors[0] as { message?: string })?.message ?? 'Decline failed');
        }
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(err instanceof Error ? err.message : 'Failed to decline issue');
      } finally {
        setBusyId(null);
      }
    },
    [issueStore],
  );

  const handleSnooze = useCallback(
    async (issueId: string, hours: number) => {
      const snapshot = issueStore.findById(issueId);
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      setBusyId(issueId);
      issueStore.optimisticUpdate(issueId, { snoozedUntilAt: until.toISOString() });
      try {
        const res = await gql(TRIAGE_SNOOZE_MUTATION, {
          issueId,
          until: until.toISOString(),
        });
        if (res.errors?.length) {
          throw new Error((res.errors[0] as { message?: string })?.message ?? 'Snooze failed');
        }
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(err instanceof Error ? err.message : 'Failed to snooze issue');
      } finally {
        setBusyId(null);
      }
    },
    [issueStore],
  );

  const handleMarkDuplicate = useCallback(
    async (issueId: string) => {
      // Minimal UX: prompt for the canonical identifier (e.g. "ENG-42").
      // The user resolves the lookup against the local issue store; the
      // resolver re-validates org/team membership server-side.
      const input = window.prompt('Mark as duplicate of (issue identifier, e.g. ENG-42):');
      if (!input) {
        return;
      }
      const ident = input.trim().toUpperCase();
      const canonical = Array.from(issueStore.pool.values()).find(i => i.identifier === ident);
      if (!canonical) {
        toast.error(`Issue ${ident} not found in your workspace`);
        return;
      }
      if (canonical.id === issueId) {
        toast.error('Cannot mark an issue as a duplicate of itself');
        return;
      }
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      issueStore.optimisticUpdate(issueId, {
        snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      try {
        const res = await gql(TRIAGE_MARK_DUPLICATE_MUTATION, {
          canonicalIssueId: canonical.id,
          issueId,
        });
        if (res.errors?.length) {
          throw new Error(
            (res.errors[0] as { message?: string })?.message ?? 'Mark duplicate failed',
          );
        }
        toast.success(`Marked as duplicate of ${ident}`);
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(err instanceof Error ? err.message : 'Failed to mark duplicate');
      } finally {
        setBusyId(null);
      }
    },
    [issueStore],
  );

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading...
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Team not found.
      </div>
    );
  }

  if (!triageStateId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-zinc-400">
        <p>Triage is not enabled for this team.</p>
        <p className="text-xs">Enable it in team settings to route incoming issues here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {team.displayName ?? team.name} — Triage
        </h1>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{queue.length} to triage</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-zinc-400 dark:text-zinc-500">
            All clear — nothing in triage.
          </div>
        ) : (
          queue.map(issue => {
            const creator = issue.creatorId ? userStore.findById(issue.creatorId) : null;
            const busy = busyId === issue.id;
            return (
              <div
                className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800"
                key={issue.id}
              >
                <span className="w-16 flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  {issue.identifier}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                    {issue.title}
                  </div>
                  {creator ? (
                    <div className="text-xs text-zinc-400 dark:text-zinc-500">
                      from {creator.displayName} · {new Date(issue.createdAt).toLocaleDateString()}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
                    disabled={busy || !defaultTargetStateId}
                    onClick={() => handleAccept(issue.id)}
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    disabled={busy}
                    onClick={() => handleDecline(issue.id)}
                    type="button"
                  >
                    Decline
                  </button>
                  <button
                    className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    disabled={busy}
                    onClick={() => handleMarkDuplicate(issue.id)}
                    title="Mark as duplicate of another issue"
                    type="button"
                  >
                    Duplicate
                  </button>
                  <SnoozeButton disabled={busy} onSelect={hours => handleSnooze(issue.id, hours)} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

export default TriagePage;
