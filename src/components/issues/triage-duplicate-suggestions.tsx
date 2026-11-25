'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionHeader } from '@/components/shared/section-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { buildIssueHref } from '@/lib/issue-nav';
import { cn, TOUCH_TARGET } from '@/lib/utils';

/**
 * Quiet period before suggestions are fetched. Holding J/K moves focus ~30
 * times a second; each new focus restarts the timer, so only the row the user
 * settles on costs a query (and an in-flight answer for a row they have
 * already left is discarded by `useRetryableFetch`'s request id).
 */
export const SUGGESTION_DEBOUNCE_MS = 250;

export interface DuplicateSuggestion {
  inTriage: boolean;
  issue: { id: string; identifier: string; title: string };
  matchedTerms: string[];
  score: number;
}

const DUPLICATE_SUGGESTIONS_QUERY = `
  query TriageDuplicateSuggestions($issueId: ID!) {
    triageDuplicateSuggestions(issueId: $issueId, first: 3) {
      score
      matchedTerms
      inTriage
      issue { id identifier title }
    }
  }
`;

interface TriageDuplicateSuggestionsProps {
  disabled: boolean;
  issueId: string;
  /** Title is part of the cache key: editing it can change what is similar. */
  issueTitle: string;
  onMarkDuplicate: (canonical: DuplicateSuggestion['issue']) => void;
}

/** `value`, but only after it has stopped changing for SUGGESTION_DEBOUNCE_MS. */
function useSettledKey(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

/**
 * "Possible duplicates" for the triage issue on screen: the server's top
 * similar non-triage issues, each with a one-click "Mark as duplicate of X"
 * that goes through the same mutation as the Duplicate picker. Renders nothing
 * while loading or when nothing is similar — a suggestion box that announces
 * its own emptiness is noise on the page whose job is speed.
 */
export function TriageDuplicateSuggestions({
  disabled,
  issueId,
  issueTitle,
  onMarkDuplicate,
}: TriageDuplicateSuggestionsProps) {
  const t = useTranslations();
  const { workspace } = useParams<{ workspace: string }>();
  const key = `${issueId}\u0000${issueTitle}`;
  const settled = useSettledKey(key);
  // The result carries the key it was fetched for, so a render between the key
  // changing and the new fetch starting never shows the previous issue's rows.
  const {
    data: result,
    error,
    loading,
    refetch,
  } = useRetryableFetch<{ key: string; list: DuplicateSuggestion[] }>(
    async () => ({
      key: settled,
      // `settled` is "<issueId>\0<title>"; the id is the part before the NUL.
      list: await gqlQuery<DuplicateSuggestion[]>(
        DUPLICATE_SUGGESTIONS_QUERY,
        { issueId: settled.split('\u0000')[0] },
        'triageDuplicateSuggestions',
      ),
    }),
    [settled],
    { key: '', list: [] },
  );
  const data = result.key === key ? result.list : [];

  if (settled !== key) {
    return null;
  }
  if (error) {
    return (
      <InlineRetry
        message={t('settings.triage.duplicateSuggestionsFailed')}
        onRetry={() => refetch()}
      />
    );
  }
  if (loading || data.length === 0) {
    return null;
  }

  return (
    <section aria-label={t('settings.triage.possibleDuplicates')} className="mt-6">
      <SectionHeader as="h3" count={data.length} title={t('settings.triage.possibleDuplicates')} />
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {data.map(s => (
          <li
            className="flex flex-col items-stretch gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
            data-testid="triage-duplicate-suggestion"
            key={s.issue.id}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-sm">
                <Link
                  className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                  href={buildIssueHref(workspace, s.issue.id)}
                >
                  {s.issue.identifier}
                </Link>
                <span className="truncate text-foreground">{s.issue.title}</span>
                {s.inTriage ? (
                  <Badge className="shrink-0" tone="info" variant="pill">
                    {t('settings.triage.inTriage')}
                  </Badge>
                ) : null}
              </div>
              {s.matchedTerms.length > 0 ? (
                <p className="truncate text-xs text-foreground-faint">
                  {t('settings.triage.duplicateMatchedTerms', { terms: s.matchedTerms.join(', ') })}
                </p>
              ) : null}
            </div>
            <Button
              className={cn(TOUCH_TARGET, 'sm:shrink-0')}
              disabled={disabled}
              onClick={() => onMarkDuplicate(s.issue)}
              size="xs"
              type="button"
              variant="outline"
            >
              {t('settings.triage.markDuplicateOf', { identifier: s.issue.identifier })}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-foreground-faint">
        {t('settings.triage.suggestionsLanguageHint')}
      </p>
    </section>
  );
}
