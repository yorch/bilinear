'use client';

import { InlineRetry } from '@/components/shared/inline-retry';
import { Skeleton } from '@/components/ui/skeleton';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { PROJECT_PROGRESS_HISTORY_QUERY } from '@/lib/graphql-queries';

interface ProgressHistoryPoint {
  completedIssueCount: number;
  date: string;
  issueCount: number;
}

interface ProgressSparklineProps {
  /** Pixel height of the rendered SVG. */
  height?: number;
  projectId: string;
  /** Pixel width of the rendered SVG. */
  width?: number;
}

export function ProgressSparkline({ projectId, width = 160, height = 28 }: ProgressSparklineProps) {
  const t = useTranslations();
  // A rejected read must not fall through to "Not enough history yet" — a
  // specific, false claim. `useRetryableFetch` only sets `error` when the
  // fetcher throws, which is why the fetcher must not swallow the failure.
  const {
    data: points,
    error,
    loading,
    refetch,
  } = useRetryableFetch<ProgressHistoryPoint[]>(
    async () => {
      const project = await gqlQuery<{ progressHistory: ProgressHistoryPoint[] } | null>(
        PROJECT_PROGRESS_HISTORY_QUERY,
        { id: projectId },
        'project',
      );
      return project?.progressHistory ?? [];
    },
    [projectId],
    [],
  );

  if (loading) {
    return <Skeleton className="h-7 w-40" />;
  }
  if (error) {
    return (
      <InlineRetry
        className="py-0"
        message={t('common.somethingWentWrong')}
        onRetry={() => refetch()}
      />
    );
  }
  if (points.length < 2) {
    return <span className="text-xs text-muted-foreground">{t('projects.notEnoughHistory')}</span>;
  }

  // Normalize: y = completedIssueCount / issueCount (0-1), or 0 if scope=0.
  const ratios = points.map(p => (p.issueCount > 0 ? p.completedIssueCount / p.issueCount : 0));
  const n = points.length;
  const stepX = n > 1 ? width / (n - 1) : 0;

  const path = ratios
    .map((r, i) => {
      const x = i * stepX;
      const y = height - r * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const fillPath = `${path} L${(n - 1) * stepX},${height} L0,${height} Z`;

  return (
    <svg
      aria-label={t('projects.progressOverTime')}
      className="text-brand"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <path d={fillPath} fill="currentColor" opacity={0.15} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
