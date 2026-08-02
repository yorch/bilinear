'use client';

import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Badge } from '@/components/ui/badge';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { PULL_REQUESTS_QUERY } from '@/lib/graphql-queries';
import { cn } from '@/lib/utils';

interface PullRequest {
  authorLogin: string;
  closedAt: string | null;
  draft: boolean;
  headBranch: string;
  id: string;
  mergedAt: string | null;
  prNumber: number;
  repoFullName: string;
  state: string;
  title: string;
  url: string;
}

interface IssuePullRequestsSectionProps {
  issueId: string;
}

export function PullRequestsSection({ issueId }: IssuePullRequestsSectionProps) {
  const t = useTranslations();
  // A failed read must not unmount the section, which would read as the
  // authoritative "this issue has no pull requests".
  const {
    data: prs,
    error: loadError,
    loading,
    refetch,
  } = useRetryableFetch<PullRequest[]>(
    async () => {
      const issue = await gqlQuery<{ pullRequests?: PullRequest[] } | null>(
        PULL_REQUESTS_QUERY,
        { issueId },
        'issue',
      );
      return issue?.pullRequests ?? [];
    },
    [issueId],
    [],
  );

  if (loading) {
    return null;
  }

  if (loadError) {
    return (
      <div className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('issueDetail.pullRequests.title')}
        </h3>
        <InlineRetry className="py-2" message={t('common.somethingWentWrong')} onRetry={refetch} />
      </div>
    );
  }

  if (prs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('issueDetail.pullRequests.title')}
      </h3>
      <ul className="space-y-1.5">
        {prs.map(pr => (
          <li key={pr.id}>
            <a
              className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              href={pr.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <PrStateIcon className="mt-0.5 shrink-0" draft={pr.draft} state={pr.state} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium leading-snug">
                  <span className="truncate">{pr.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t('issueDetail.pullRequests.metaLine', {
                    author: pr.authorLogin,
                    branch: pr.headBranch,
                    number: pr.prNumber,
                    repo: pr.repoFullName,
                  })}
                </div>
              </div>
              <PrStateBadge draft={pr.draft} state={pr.state} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrStateIcon({
  state,
  draft,
  className,
}: {
  state: string;
  draft: boolean;
  className?: string;
}) {
  if (state === 'merged') {
    return <GitMerge className={cn('h-4 w-4 text-merged-subtle-foreground', className)} />;
  }
  if (state === 'closed') {
    return (
      <GitPullRequestClosed className={cn('h-4 w-4 text-danger-subtle-foreground', className)} />
    );
  }
  return (
    <GitPullRequest
      className={cn(
        'h-4 w-4',
        draft ? 'text-muted-foreground' : 'text-success-subtle-foreground',
        className,
      )}
    />
  );
}

function PrStateBadge({ state, draft }: { state: string; draft: boolean }) {
  const t = useTranslations();
  if (state === 'merged') {
    return (
      <Badge className="shrink-0 bg-merged-subtle text-merged-subtle-foreground">
        {t('issueDetail.pullRequests.merged')}
      </Badge>
    );
  }
  if (state === 'closed') {
    return (
      <Badge className="shrink-0 bg-danger-subtle text-danger-subtle-foreground">
        {t('issueDetail.pullRequests.closed')}
      </Badge>
    );
  }
  if (draft) {
    return (
      <Badge className="shrink-0 bg-muted text-muted-foreground">
        {t('issueDetail.pullRequests.draft')}
      </Badge>
    );
  }
  return (
    <Badge className="shrink-0 bg-success-subtle text-success-subtle-foreground">
      {t('issueDetail.pullRequests.open')}
    </Badge>
  );
}
