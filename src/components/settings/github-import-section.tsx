'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';

const PREVIEW_QUERY = `
  query GithubImportPreview($teamId: ID!, $repo: String!, $token: String) {
    githubImportPreview(teamId: $teamId, repo: $repo, token: $token) {
      repo tokenSource totalIssues
    }
  }
`;

const RUN_MUTATION = `
  mutation GithubImportRun($input: GithubImportInput!) {
    githubImportRun(input: $input) {
      processed created existing commentsCreated labelsCreated errors nextPage tokenSource
      closedAsOpen commentsTruncated limitReached
    }
  }
`;

interface Preview {
  repo: string;
  tokenSource: 'integration' | 'none' | 'personal';
  totalIssues: number | null;
}

interface Chunk {
  closedAsOpen: number;
  commentsCreated: number;
  commentsTruncated: number;
  created: number;
  errors: string[];
  existing: number;
  labelsCreated: number;
  limitReached: boolean;
  nextPage: number | null;
  processed: number;
}

interface Totals {
  closedAsOpen: number;
  comments: number;
  commentsTruncated: number;
  created: number;
  errors: string[];
  existing: number;
  labels: number;
  processed: number;
}

const EMPTY_TOTALS: Totals = {
  closedAsOpen: 0,
  comments: 0,
  commentsTruncated: 0,
  created: 0,
  errors: [],
  existing: 0,
  labels: 0,
  processed: 0,
};

interface GithubImportSectionProps {
  teams: Array<{ id: string; name: string }>;
}

/**
 * Imports a repository's GitHub Issues one API page per request. The client
 * drives the loop, so progress is real, a closed tab simply stops, and starting
 * again resumes (already-imported issues are skipped server-side).
 *
 * The personal access token lives only in this component's state, is sent with
 * each request, and is cleared when the run ends. The server never stores it.
 */
export function GithubImportSection({ teams }: GithubImportSectionProps) {
  const t = useTranslations();
  const [teamId, setTeamId] = useState('');
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [includeClosed, setIncludeClosed] = useState(true);
  const [includeComments, setIncludeComments] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [finished, setFinished] = useState(false);
  // Set when a run stopped at the per-run row cap: the page a new run resumes at.
  const [resumePage, setResumePage] = useState<number | null>(null);
  const cancelRef = useRef(false);

  const ready = Boolean(teamId && repo.trim());

  async function checkRepo() {
    if (!ready) {
      toast.error(
        !teamId ? t('settings.import.selectTeam') : t('settings.import.github.repoRequired'),
      );
      return;
    }
    setChecking(true);
    setPreview(null);
    try {
      const data = await gqlQuery<Preview | null>(
        PREVIEW_QUERY,
        { repo: repo.trim(), teamId, token: token.trim() || null },
        'githubImportPreview',
      );
      setPreview(data);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.import.github.checkFailed')));
    } finally {
      setChecking(false);
    }
  }

  async function run() {
    cancelRef.current = false;
    setRunning(true);
    setFinished(false);
    // Continuing after the row cap keeps the running totals and starts a new
    // run (its own cap window) at the page the last one stopped on.
    const startPage = resumePage ?? 1;
    let acc: Totals = resumePage ? { ...totals } : { ...EMPTY_TOTALS };
    setResumePage(null);
    setTotals(acc);
    let page: number | null = startPage;
    try {
      while (page !== null && !cancelRef.current) {
        const res = (await gqlMutate(RUN_MUTATION, {
          input: {
            includeClosed,
            includeComments,
            page,
            repo: repo.trim(),
            startPage,
            teamId,
            token: token.trim() || null,
          },
        })) as { githubImportRun?: Chunk };
        const chunk = res.githubImportRun;
        if (!chunk) {
          throw new Error(t('settings.import.importFailed'));
        }
        acc = {
          closedAsOpen: acc.closedAsOpen + chunk.closedAsOpen,
          comments: acc.comments + chunk.commentsCreated,
          commentsTruncated: acc.commentsTruncated + chunk.commentsTruncated,
          created: acc.created + chunk.created,
          errors: [...acc.errors, ...chunk.errors],
          existing: acc.existing + chunk.existing,
          labels: acc.labels + chunk.labelsCreated,
          processed: acc.processed + chunk.processed,
        };
        setTotals(acc);
        page = chunk.nextPage;
        if (chunk.limitReached) {
          setResumePage(chunk.nextPage);
          toast.info(t('settings.import.github.limitReached'));
          break;
        }
      }
      setFinished(page === null);
      if (page === null) {
        toast.success(t('settings.import.importedCount', { count: acc.created }));
      }
    } catch (err) {
      // Everything up to the failed chunk is already imported; running again resumes.
      toast.error(getErrorMessage(err, t('settings.import.importFailed')));
    } finally {
      setRunning(false);
      setToken('');
    }
  }

  const percent =
    preview?.totalIssues && preview.totalIssues > 0
      ? Math.min(100, Math.round((totals.processed / preview.totalIssues) * 100))
      : null;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 md:p-6">
      <h2 className="font-medium">{t('settings.import.github.heading')}</h2>
      <p className="text-xs text-muted-foreground">{t('settings.import.github.hint')}</p>

      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-sm font-medium">
            {t('settings.import.importIntoTeam')} <span className="text-danger">*</span>
          </span>
          <SimpleSelect
            ariaLabel={t('settings.import.importIntoTeam')}
            onChange={value => {
              setTeamId(value);
              setResumePage(null);
            }}
            options={teams.map(team => ({ label: team.name, value: team.id }))}
            placeholder={
              teams.length === 0 ? t('settings.import.noTeams') : t('settings.import.chooseTeam')
            }
            value={teamId}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="gh-import-repo">
            {t('settings.import.github.repo')} <span className="text-danger">*</span>
          </label>
          <Input
            autoComplete="off"
            disabled={running}
            id="gh-import-repo"
            onChange={e => {
              setRepo(e.target.value);
              setResumePage(null);
              setPreview(null);
            }}
            placeholder="owner/name"
            value={repo}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="gh-import-token">
            {t('settings.import.github.token')}
          </label>
          <Input
            autoComplete="off"
            disabled={running}
            id="gh-import-token"
            onChange={e => {
              setToken(e.target.value);
              setPreview(null);
            }}
            placeholder="ghp_…"
            type="password"
            value={token}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('settings.import.github.tokenHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-9 items-center gap-2 text-sm" htmlFor="gh-import-closed">
            <Checkbox
              checked={includeClosed}
              disabled={running}
              id="gh-import-closed"
              onChange={() => setIncludeClosed(v => !v)}
            />
            {t('settings.import.github.includeClosed')}
          </label>
          <label className="flex min-h-9 items-center gap-2 text-sm" htmlFor="gh-import-comments">
            <Checkbox
              checked={includeComments}
              disabled={running}
              id="gh-import-comments"
              onChange={() => setIncludeComments(v => !v)}
            />
            {t('settings.import.github.includeComments')}
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!ready || checking || running}
          onClick={() => void checkRepo()}
          size="sm"
          type="button"
          variant="outline"
        >
          {checking ? t('settings.import.github.checking') : t('settings.import.github.check')}
        </Button>
        <Button disabled={!ready || running} onClick={() => void run()} size="sm" type="button">
          {running
            ? t('settings.import.importingEllipsis')
            : resumePage
              ? t('settings.import.github.continue', { page: resumePage })
              : t('settings.import.github.start')}
        </Button>
        {running && (
          <Button
            onClick={() => {
              cancelRef.current = true;
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t('settings.import.github.stop')}
          </Button>
        )}
      </div>

      {preview && (
        <p className="text-xs text-muted-foreground">
          {preview.totalIssues === null
            ? t('settings.import.github.previewUnknown', { repo: preview.repo })
            : t('settings.import.github.previewCount', {
                count: preview.totalIssues,
                repo: preview.repo,
              })}{' '}
          {t(`settings.import.github.source.${preview.tokenSource}`)}
        </p>
      )}

      {(running || finished || totals.processed > 0) && (
        <div aria-live="polite" className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
          {percent !== null && (
            <ProgressBar className="h-2" value={running ? percent : finished ? 100 : percent} />
          )}
          <p>
            {t('settings.import.github.progress', {
              created: totals.created,
              existing: totals.existing,
              processed: totals.processed,
            })}
          </p>
          {(totals.labels > 0 || totals.comments > 0) && (
            <p className="text-xs text-muted-foreground">
              {t('settings.import.github.extras', {
                comments: totals.comments,
                labels: totals.labels,
              })}
            </p>
          )}
          {totals.closedAsOpen > 0 && (
            <p className="text-xs text-warning-subtle-foreground">
              {t('settings.import.github.closedAsOpen', { count: totals.closedAsOpen })}
            </p>
          )}
          {totals.commentsTruncated > 0 && (
            <p className="text-xs text-warning-subtle-foreground">
              {t('settings.import.github.commentsTruncated', { count: totals.commentsTruncated })}
            </p>
          )}
          {resumePage !== null && (
            <p className="text-xs text-muted-foreground">
              {t('settings.import.github.limitReachedHint', { page: resumePage })}
            </p>
          )}
          {finished && (
            <p className="text-xs text-muted-foreground">{t('settings.import.github.done')}</p>
          )}
          {totals.errors.length > 0 && (
            <ul className="max-h-40 list-disc overflow-auto pl-5 text-xs text-danger-subtle-foreground">
              {totals.errors.map(e => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
