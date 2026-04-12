'use client';

import { Activity, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
import { cn, formatRelativeTime } from '@/lib/utils';

interface ActivityActor {
  id: string;
  displayName: string;
  initials: string;
  avatarBgColor: string | null;
}

interface IssueActivity {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  actor: ActivityActor | null;
}

interface ActivityTimelineProps {
  issueId: string;
  /** Increment this to trigger a re-fetch (e.g. after an issue update). */
  refetchKey?: number;
}

const GET_ISSUE_ACTIVITIES_QUERY = `
  query GetIssueActivities($issueId: ID!, $limit: Int) {
    issueActivities(issueId: $issueId, limit: $limit) {
      id
      field
      oldValue
      newValue
      createdAt
      actor {
        id
        displayName
        initials
        avatarBgColor
      }
    }
  }
`;

const FIELD_LABELS: Record<string, string> = {
  assigneeId: 'assignee',
  cycleId: 'cycle',
  description: 'description',
  dueDate: 'due date',
  estimate: 'estimate',
  labels: 'labels',
  priority: 'priority',
  projectId: 'project',
  status: 'status',
  title: 'title',
};

function getFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatActivityDescription(activity: IssueActivity): string {
  const actorName = activity.actor?.displayName ?? 'System';
  const field = getFieldLabel(activity.field);

  if (activity.newValue === null) {
    return `${actorName} cleared ${field}`;
  }
  if (activity.oldValue === null) {
    return `${actorName} set ${field} to ${activity.newValue}`;
  }
  return `${actorName} changed ${field} from ${activity.oldValue} to ${activity.newValue}`;
}

const COLLAPSE_THRESHOLD = 5;

export function ActivityTimeline({
  issueId,
  refetchKey,
}: ActivityTimelineProps) {
  const [activities, setActivities] = useState<IssueActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!issueId) {
      return;
    }
    void refetchKey; // referenced so this dep is not pruned

    let cancelled = false;

    const fetchActivities = async () => {
      setLoading(true);
      try {
        const res = await gql(GET_ISSUE_ACTIVITIES_QUERY, {
          issueId,
          limit: 50,
        });
        if (!cancelled) {
          const data = res.data as
            | { issueActivities?: IssueActivity[] }
            | undefined;
          // Newest first
          const sorted = [...(data?.issueActivities ?? [])].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          setActivities(sorted);
        }
      } catch {
        // Silently fail — activity is supplementary information
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchActivities();
    return () => {
      cancelled = true;
    };
  }, [issueId, refetchKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-zinc-400">
        <Clock className="h-3.5 w-3.5 animate-pulse" />
        <span>Loading activity…</span>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-zinc-400">
        <Activity className="h-3.5 w-3.5" />
        <span>No activity recorded yet.</span>
      </div>
    );
  }

  const shouldCollapse = activities.length > COLLAPSE_THRESHOLD;
  const visibleActivities =
    shouldCollapse && !expanded
      ? activities.slice(0, COLLAPSE_THRESHOLD)
      : activities;
  const hiddenCount = activities.length - COLLAPSE_THRESHOLD;

  return (
    <div className="flex flex-col gap-0">
      {visibleActivities.map((activity, index) => {
        const actor = activity.actor;
        const isLast =
          index === visibleActivities.length - 1 &&
          (!shouldCollapse || expanded);

        return (
          <div key={activity.id} className="flex gap-3">
            {/* Timeline line + avatar */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                  actor?.avatarBgColor ? '' : 'bg-zinc-400 dark:bg-zinc-600',
                )}
                style={
                  actor?.avatarBgColor
                    ? { backgroundColor: actor.avatarBgColor }
                    : undefined
                }
                title={actor?.displayName ?? 'System'}
              >
                {actor?.initials ?? 'S'}
              </span>
              {!isLast && (
                <div className="my-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              )}
            </div>

            {/* Content */}
            <div className={cn('min-w-0 flex-1 pb-3', isLast && 'pb-0')}>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {formatActivityDescription(activity)}
              </p>
              <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                {formatRelativeTime(activity.createdAt)}
              </p>
            </div>
          </div>
        );
      })}

      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-1 text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
