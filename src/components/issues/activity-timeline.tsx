'use client';

import { Activity, Clock } from 'lucide-react';
import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { ISSUE_ACTIVITIES_QUERY } from '@/lib/graphql-queries';
import { cn } from '@/lib/utils';

interface ActivityActor {
  /** Aliased from `User.avatarBackgroundColor`, which is `String!`. */
  avatarBgColor: string;
  displayName: string;
  id: string;
  initials: string;
}

interface IssueActivity {
  actor: ActivityActor | null;
  createdAt: string;
  field: string;
  id: string;
  newValue: string | null;
  oldValue: string | null;
}

interface ActivityTimelineProps {
  issueId: string;
  /** Increment this to trigger a re-fetch (e.g. after an issue update). */
  refetchKey?: number;
}

/**
 * Keyed by the raw `IssueActivity.field` string the server writes — NOT by the
 * GraphQL/UI name for the same concept. `getFieldLabel` falls through to the
 * raw field when a key is missing, so a name that doesn't match the server
 * renders the camelCase column into the sentence ("changed stateId from … to
 * …") in every locale, without ever reaching `t()`.
 *
 * The writers are `TRACKED_ACTIVITY_FIELDS` in `server/graphql/resolvers/
 * issue.ts` plus the four one-off pushes in `issue.ts` (labelAdded/
 * labelRemoved), `issue-relation.ts` (stateId) and `comment.ts`
 * (commentResolved/commentUnresolved). Keep this map in step with them.
 */
const FIELD_LABEL_KEYS: Record<string, string> = {
  assigneeId: 'issueDetail.activity.fields.assignee',
  commentResolved: 'issueDetail.activity.fields.comment',
  commentUnresolved: 'issueDetail.activity.fields.comment',
  cycleId: 'issueDetail.activity.fields.cycle',
  description: 'issueDetail.activity.fields.description',
  dueDate: 'issueDetail.activity.fields.dueDate',
  estimate: 'issueDetail.activity.fields.estimate',
  labelAdded: 'issueDetail.activity.fields.labels',
  labelRemoved: 'issueDetail.activity.fields.labels',
  parentId: 'issueDetail.activity.fields.parent',
  priority: 'issueDetail.activity.fields.priority',
  projectId: 'issueDetail.activity.fields.project',
  startDate: 'issueDetail.activity.fields.startDate',
  stateId: 'issueDetail.activity.fields.status',
  title: 'issueDetail.activity.fields.title',
  trashed: 'issueDetail.activity.fields.trashed',
};

function getFieldLabel(field: string, t: ReturnType<typeof useTranslations>): string {
  const key = FIELD_LABEL_KEYS[field];
  return key ? t(key) : field;
}

function formatActivityDescription(
  activity: IssueActivity,
  t: ReturnType<typeof useTranslations>,
): string {
  const actorName = activity.actor?.displayName ?? t('issueDetail.activity.system');
  const field = getFieldLabel(activity.field, t);

  if (activity.newValue === null) {
    return t('issueDetail.activity.cleared', { actor: actorName, field });
  }
  if (activity.oldValue === null) {
    return t('issueDetail.activity.set', { actor: actorName, field, value: activity.newValue });
  }
  return t('issueDetail.activity.changed', {
    actor: actorName,
    field,
    newValue: activity.newValue,
    oldValue: activity.oldValue,
  });
}

const COLLAPSE_THRESHOLD = 5;

export function ActivityTimeline({ issueId, refetchKey }: ActivityTimelineProps) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const [expanded, setExpanded] = useState(false);

  const {
    data: activities,
    loading,
    error,
    refetch,
  } = useRetryableFetch<IssueActivity[]>(
    async () => {
      const activities = await gqlQuery<IssueActivity[]>(
        ISSUE_ACTIVITIES_QUERY,
        { issueId, limit: 50 },
        'issueActivities',
      );
      // Newest first
      return [...(activities ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    [issueId, refetchKey],
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 animate-pulse" />
        <span>{t('issueDetail.activity.loading')}</span>
      </div>
    );
  }

  if (error && activities.length === 0) {
    return (
      <InlineRetry message={t('issueDetail.activity.failedToLoad')} onRetry={() => refetch()} />
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span>{t('issueDetail.activity.empty')}</span>
      </div>
    );
  }

  const shouldCollapse = activities.length > COLLAPSE_THRESHOLD;
  const visibleActivities =
    shouldCollapse && !expanded ? activities.slice(0, COLLAPSE_THRESHOLD) : activities;
  const hiddenCount = activities.length - COLLAPSE_THRESHOLD;

  return (
    <div className="flex flex-col gap-0">
      {visibleActivities.map((activity, index) => {
        const actor = activity.actor;
        const isLast = index === visibleActivities.length - 1 && (!shouldCollapse || expanded);

        return (
          <div className="flex gap-3" key={activity.id}>
            {/* Timeline line + avatar */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                  actor?.avatarBgColor ? '' : 'bg-avatar-fallback',
                )}
                style={actor?.avatarBgColor ? { backgroundColor: actor.avatarBgColor } : undefined}
                title={actor?.displayName ?? t('issueDetail.activity.system')}
              >
                {actor?.initials ?? 'S'}
              </span>
              {!isLast && <div className="my-1 w-px flex-1 bg-muted" />}
            </div>

            {/* Content */}
            <div className={cn('min-w-0 flex-1 pb-3', isLast && 'pb-0')}>
              <p className="text-xs text-muted-foreground">
                {formatActivityDescription(activity, t)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatRelativeTime(activity.createdAt)}
              </p>
            </div>
          </div>
        );
      })}

      {shouldCollapse && (
        <button
          className="mt-1 text-xs text-brand hover:text-brand-hover"
          onClick={() => setExpanded(e => !e)}
          type="button"
        >
          {expanded
            ? t('issueDetail.activity.showLess')
            : t('issueDetail.activity.showMore', { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}
