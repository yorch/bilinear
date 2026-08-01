'use client';

import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Badge } from '@/components/ui/badge';
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
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // `gqlQuery` throws on a GraphQL-level failure so the error branch below is
  // reachable — the old `.catch(() => setPrs([]))` unmounted the section, which
  // read as the authoritative "this issue has no pull requests".
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a deliberate refetch trigger, not read inside the effect
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gqlQuery<{ pullRequests?: PullRequest[] } | null>(PULL_REQUESTS_QUERY, { issueId }, 'issue')
      .then(issue => {
        if (cancelled) {
          return;
        }
        setPrs(issue?.pullRequests ?? []);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [issueId, reloadKey]);

  if (loading) {
    return null;
  }

  if (loadError) {
    return (
      <div className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('issueDetail.pullRequests.title')}
        </h3>
        <InlineRetry
          className="py-2"
          message={t('common.somethingWentWrong')}
          onRetry={() => setReloadKey(k => k + 1)}
        />
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
    return <GitMerge className={cn('h-4 w-4 text-purple-500', className)} />;
  }
  if (state === 'closed') {
    return <GitPullRequestClosed className={cn('h-4 w-4 text-red-500', className)} />;
  }
  return (
    <GitPullRequest
      className={cn('h-4 w-4', draft ? 'text-muted-foreground' : 'text-green-500', className)}
    />
  );
}

function PrStateBadge({ state, draft }: { state: string; draft: boolean }) {
  const t = useTranslations();
  if (state === 'merged') {
    return (
      <Badge className="shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        {t('issueDetail.pullRequests.merged')}
      </Badge>
    );
  }
  if (state === 'closed') {
    return (
      <Badge className="shrink-0 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
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
    <Badge className="shrink-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
      {t('issueDetail.pullRequests.open')}
    </Badge>
  );
}
