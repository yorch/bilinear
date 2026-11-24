/**
 * Minimal read-only GitHub REST client for the Issues importer.
 *
 * Talks to api.github.com only (the host is fixed; the repo slug is validated
 * before it is interpolated), so a caller-supplied value can never redirect the
 * request. The token is sent as a bearer header and is never logged or echoed
 * in an error message.
 */

export const GITHUB_API = 'https://api.github.com';

export interface GithubIssueLabel {
  color?: string | null;
  name: string;
}

export interface GithubIssue {
  assignee: { login: string } | null;
  assignees?: Array<{ login: string }>;
  body: string | null;
  closed_at: string | null;
  comments: number;
  created_at: string;
  html_url: string;
  labels: Array<GithubIssueLabel | string>;
  number: number;
  /** Present on pull requests, which the issues endpoint also returns. */
  pull_request?: unknown;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
  title: string;
  user: { login: string } | null;
}

export interface GithubComment {
  body: string;
  created_at: string;
  id: number;
  user: { login: string } | null;
}

export interface GithubIssuePage {
  hasNext: boolean;
  items: GithubIssue[];
}

/** The surface the importer needs; tests substitute a fake. */
export interface GithubIssuesClient {
  countIssues(repo: string, token: string | undefined): Promise<number | null>;
  /** Public profile email for a login, or null when the user hides it. */
  getUserEmail(login: string, token: string | undefined): Promise<string | null>;
  listComments(repo: string, number: number, token: string | undefined): Promise<GithubComment[]>;
  listIssues(
    repo: string,
    token: string | undefined,
    opts: { includeClosed: boolean; page: number; perPage: number },
  ): Promise<GithubIssuePage>;
}

export class GithubRepoNotFoundError extends Error {
  constructor() {
    super(
      'Repository not found. Check the name, or use a personal access token with access to a private repository.',
    );
    this.name = 'GithubRepoNotFoundError';
  }
}

export class GithubTokenInvalidError extends Error {
  constructor() {
    super('GitHub rejected the token. It may be expired or lack access to this repository.');
    this.name = 'GithubTokenInvalidError';
  }
}

export class GithubRateLimitedError extends Error {
  constructor(resetAt: Date | null) {
    super(
      resetAt
        ? `GitHub rate limit reached. Try again after ${resetAt.toISOString()}, or use a personal access token for a higher limit.`
        : 'GitHub rate limit reached. Try again later, or use a personal access token for a higher limit.',
    );
    this.name = 'GithubRateLimitedError';
  }
}

export class GithubInvalidRepoError extends Error {
  constructor() {
    super('Repository must look like "owner/name".');
    this.name = 'GithubInvalidRepoError';
  }
}

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;

/** Accepts `owner/name` or a github.com URL; returns the normalised slug. */
export function parseRepoSlug(input: string): string {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const slug = trimmed.split('/').slice(0, 2).join('/');
  if (!REPO_RE.test(slug) || slug.split('/').some(p => p === '.' || p === '..')) {
    throw new GithubInvalidRepoError();
  }
  return slug;
}

export function createGithubIssuesClient(fetchImpl: typeof fetch = fetch): GithubIssuesClient {
  async function request(path: string, token: string | undefined): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Bilinear-Importer/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetchImpl(`${GITHUB_API}${path}`, { headers });
    if (res.ok) {
      return res;
    }
    if (res.status === 401) {
      throw new GithubTokenInvalidError();
    }
    if (res.status === 404) {
      throw new GithubRepoNotFoundError();
    }
    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
    ) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      throw new GithubRateLimitedError(
        Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null,
      );
    }
    throw new Error(`GitHub request failed with status ${res.status}`);
  }

  return {
    async countIssues(repo, token) {
      try {
        const q = encodeURIComponent(`repo:${repo} is:issue`);
        const res = await request(`/search/issues?q=${q}&per_page=1`, token);
        const body = (await res.json()) as { total_count?: number };
        return typeof body.total_count === 'number' ? body.total_count : null;
      } catch (err) {
        // The count is a nicety; a rate-limited search must not block the import.
        if (err instanceof GithubRepoNotFoundError || err instanceof GithubTokenInvalidError) {
          throw err;
        }
        return null;
      }
    },

    async getUserEmail(login, token) {
      if (!LOGIN_RE.test(login)) {
        return null;
      }
      try {
        const res = await request(`/users/${login}`, token);
        const body = (await res.json()) as { email?: string | null };
        return body.email ?? null;
      } catch {
        return null;
      }
    },

    async listComments(repo, number, token) {
      const res = await request(`/repos/${repo}/issues/${number}/comments?per_page=100`, token);
      return (await res.json()) as GithubComment[];
    },

    async listIssues(repo, token, opts) {
      const state = opts.includeClosed ? 'all' : 'open';
      const res = await request(
        `/repos/${repo}/issues?state=${state}&sort=created&direction=asc&per_page=${opts.perPage}&page=${opts.page}`,
        token,
      );
      const all = (await res.json()) as GithubIssue[];
      return {
        hasNext: /rel="next"/.test(res.headers.get('link') ?? ''),
        // The issues endpoint interleaves pull requests; they are not issues.
        items: all.filter(i => !i.pull_request),
      };
    },
  };
}
