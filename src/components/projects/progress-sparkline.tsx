'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
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
  const [points, setPoints] = useState<ProgressHistoryPoint[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await gql(PROJECT_PROGRESS_HISTORY_QUERY, { id: projectId });
      const data = res.data as
        | { project?: { progressHistory: ProgressHistoryPoint[] } }
        | undefined;
      setPoints(data?.project?.progressHistory ?? []);
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (!loaded) {
    return <div className="h-7 w-40 animate-pulse rounded bg-muted" />;
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
      className="text-indigo-500"
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
