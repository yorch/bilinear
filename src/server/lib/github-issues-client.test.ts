import { describe, expect, it, vi } from 'vitest';
import {
  createGithubIssuesClient,
  GithubRateLimitedError,
  GithubRepoNotFoundError,
  GithubTokenInvalidError,
} from './github-issues-client';

function res(body: unknown, init: { headers?: Record<string, string>; status?: number } = {}) {
  return new Response(JSON.stringify(body), { headers: init.headers, status: init.status ?? 200 });
}

describe('createGithubIssuesClient', () => {
  it('drops pull requests, reads the Link header, and sends the token as a bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      res([{ number: 1 }, { number: 2, pull_request: {} }], {
        headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
      }),
    );
    const client = createGithubIssuesClient(fetchMock as never);

    const page = await client.listIssues('acme/app', 'tok', {
      includeClosed: true,
      page: 1,
      perPage: 30,
    });

    expect(page.items.map(i => i.number)).toEqual([1]);
    expect(page.hasNext).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/acme/app/issues?state=all&sort=created&direction=asc&per_page=30&page=1',
    );
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('sends no Authorization header without a token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res([]));
    await createGithubIssuesClient(fetchMock as never).listIssues('a/b', undefined, {
      includeClosed: false,
      page: 1,
      perPage: 30,
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain('state=open');
  });

  it('maps 404, 401 and rate limiting to typed errors that never contain the token', async () => {
    const call = (status: number, headers: Record<string, string> = {}) =>
      createGithubIssuesClient(
        vi.fn().mockResolvedValue(res({}, { headers, status })) as never,
      ).listIssues('a/b', 'secret-token', { includeClosed: true, page: 1, perPage: 30 });
    await expect(call(404)).rejects.toBeInstanceOf(GithubRepoNotFoundError);
    await expect(call(401)).rejects.toBeInstanceOf(GithubTokenInvalidError);
    await expect(call(403, { 'x-ratelimit-remaining': '0' })).rejects.toBeInstanceOf(
      GithubRateLimitedError,
    );
    await expect(call(429)).rejects.toBeInstanceOf(GithubRateLimitedError);
    await expect(call(500)).rejects.not.toThrow(/secret-token/);
  });

  it('never looks up a login that could alter the request path', async () => {
    const fetchMock = vi.fn();
    const email = await createGithubIssuesClient(fetchMock as never).getUserEmail(
      '../orgs',
      undefined,
    );
    expect(email).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a failed profile lookup as "no email"', async () => {
    const client = createGithubIssuesClient(
      vi.fn().mockResolvedValue(res({}, { status: 404 })) as never,
    );
    expect(await client.getUserEmail('ghost', undefined)).toBeNull();
  });
});
