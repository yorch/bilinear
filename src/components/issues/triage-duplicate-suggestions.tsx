'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionHeader } from '@/components/shared/section-header';
import { Button } from '@/components/ui/button';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { buildIssueHref } from '@/lib/issue-nav';

export interface DuplicateSuggestion {
  issue: { id: string; identifier: string; title: string };
  matchedTerms: string[];
  score: number;
}

const DUPLICATE_SUGGESTIONS_QUERY = `
  query TriageDuplicateSuggestions($issueId: ID!) {
    triageDuplicateSuggestions(issueId: $issueId, first: 3) {
      score
      matchedTerms
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
  const { data, error, loading, refetch } = useRetryableFetch<DuplicateSuggestion[]>(
    () =>
      gqlQuery<DuplicateSuggestion[]>(
        DUPLICATE_SUGGESTIONS_QUERY,
        { issueId },
        'triageDuplicateSuggestions',
      ),
    [issueId, issueTitle],
    [],
  );

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
            className="flex items-center gap-3 px-3 py-2"
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
              </div>
              {s.matchedTerms.length > 0 ? (
                <p className="truncate text-xs text-foreground-faint">
                  {t('settings.triage.duplicateMatchedTerms', { terms: s.matchedTerms.join(', ') })}
                </p>
              ) : null}
            </div>
            <Button
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
    </section>
  );
}
