'use client';

import { useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface AiInsightsProps {
  issueId: string;
}

interface DuplicateIssue {
  id: string;
  identifier: string;
  title: string;
}

const buttonClass = cn(
  'shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium',
  'text-indigo-600 hover:bg-indigo-50 disabled:opacity-50',
  'dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-indigo-950/30',
);

export function AiInsights({ issueId }: AiInsightsProps) {
  const [available, setAvailable] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [findingDuplicates, setFindingDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateIssue[] | null>(null);

  // Probe AI availability when the issue changes; reset all state so results
  // from a previous issue never leak into the newly selected one. The effect
  // body only calls setters, so Biome flags issueId as redundant — but the
  // effect must re-run on every issue change, hence the dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on issue change
  useEffect(() => {
    setAvailable(false);
    setSummarizing(false);
    setSummary(null);
    setFindingDuplicates(false);
    setDuplicates(null);

    gql('query AiAvailable { aiAvailable }')
      .then(res => {
        if (res.errors?.length) {
          setAvailable(false);
          return;
        }
        setAvailable(Boolean((res.data as { aiAvailable?: boolean })?.aiAvailable));
      })
      .catch(() => setAvailable(false));
  }, [issueId]);

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      const res = await gql(
        'mutation AiSummarizeIssue($issueId: ID!) { aiSummarizeIssue(issueId: $issueId) { success summary } }',
        { issueId },
      );
      if (res.errors?.length) {
        toast.error('Could not summarize issue');
        return;
      }
      const result = (res.data as { aiSummarizeIssue?: { summary?: string } })?.aiSummarizeIssue;
      setSummary(result?.summary ?? '');
    } catch {
      toast.error('Could not summarize issue');
    } finally {
      setSummarizing(false);
    }
  };

  const handleFindDuplicates = async () => {
    setFindingDuplicates(true);
    try {
      const res = await gql(
        'mutation AiFindDuplicateIssues($issueId: ID!) { aiFindDuplicateIssues(issueId: $issueId) { success duplicates { id identifier title } } }',
        { issueId },
      );
      if (res.errors?.length) {
        toast.error('Could not check for duplicates');
        return;
      }
      const result = (res.data as { aiFindDuplicateIssues?: { duplicates?: DuplicateIssue[] } })
        ?.aiFindDuplicateIssues;
      setDuplicates(result?.duplicates ?? []);
    } catch {
      toast.error('Could not check for duplicates');
    } finally {
      setFindingDuplicates(false);
    }
  };

  if (!available) {
    return null;
  }

  return (
    <div className="mt-6">
      <p className="mb-1 text-xs font-medium text-zinc-500">AI</p>
      <div className="flex items-center gap-2">
        <button
          className={buttonClass}
          disabled={summarizing}
          onClick={handleSummarize}
          title="Summarize this issue"
          type="button"
        >
          {summarizing ? '…' : '✨ Summarize'}
        </button>
        <button
          className={buttonClass}
          disabled={findingDuplicates}
          onClick={handleFindDuplicates}
          title="Find likely duplicate issues"
          type="button"
        >
          {findingDuplicates ? '…' : '🔍 Find duplicates'}
        </button>
      </div>

      {summary !== null && (
        <div className="mt-2 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
          {summary}
        </div>
      )}

      {duplicates !== null &&
        (duplicates.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No likely duplicates found.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {duplicates.map(dup => (
              <li
                className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                key={dup.id}
              >
                <span className="font-mono text-xs text-zinc-400">{dup.identifier}</span>
                <span>— {dup.title}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
