import { beforeEach, describe, expect, it, vi } from 'vitest';

const counters = new Map<string, number>();
vi.mock('../../middleware/rate-limit', () => ({
  checkFixedWindow: async (key: string, limit: number) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    return { count, exceeded: count > limit };
  },
}));
vi.mock('../../middleware/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('../../middleware/auth')>()),
  requireTeamMemberNotGuest: vi.fn().mockResolvedValue(undefined),
}));
const importPage = vi.fn();
vi.mock('../../services/github-import.service', () => ({
  GithubImportService: class {
    importPage = importPage;
  },
}));

import type { GraphQLContext } from '../context';
import {
  GITHUB_IMPORT_LIMIT_PER_TEAM,
  GITHUB_IMPORT_LIMIT_PER_USER,
  importResolvers,
} from './import';

function ctxFor(userId: string) {
  return {
    config: undefined,
    orgId: 'org-1',
    prisma: {},
    services: {
      sync: { createSyncAction: vi.fn(), getLastSyncId: vi.fn().mockResolvedValue('1') },
    },
    userId,
  } as unknown as GraphQLContext;
}

const run = (ctx: GraphQLContext, teamId = 'team-1') =>
  importResolvers.Mutation.githubImportRun(undefined, { input: { repo: 'a/b', teamId } }, ctx);

describe('githubImportRun rate limit', () => {
  beforeEach(() => {
    counters.clear();
    importPage.mockReset().mockResolvedValue({
      closedAsOpen: 0,
      commentsTruncated: 0,
      createdComments: [],
      createdFieldDefinition: null,
      createdIssues: [],
      createdLabels: [],
      errors: [],
      existing: 0,
      fieldValues: [],
      limitReached: false,
      nextPage: null,
      processed: 0,
      tokenSource: 'none',
    });
  });

  it('throttles one team across many users', async () => {
    for (let i = 0; i < GITHUB_IMPORT_LIMIT_PER_TEAM; i++) {
      await run(ctxFor(`u-${i}`));
    }
    await expect(run(ctxFor('someone-else'))).rejects.toMatchObject({
      extensions: { code: 'RATELIMITED' },
    });
    expect(importPage).toHaveBeenCalledTimes(GITHUB_IMPORT_LIMIT_PER_TEAM);
  });

  it('throttles one user across many teams', async () => {
    for (let i = 0; i < GITHUB_IMPORT_LIMIT_PER_USER; i++) {
      await run(ctxFor('u'), `team-${i}`);
    }
    await expect(run(ctxFor('u'), 'fresh-team')).rejects.toMatchObject({
      extensions: { code: 'RATELIMITED' },
    });
  });

  it('reports a busy team as RATELIMITED, not an internal error', async () => {
    importPage.mockRejectedValue(
      Object.assign(new Error('busy'), { name: 'GithubImportBusyError' }),
    );
    await expect(run(ctxFor('u'))).rejects.toMatchObject({ extensions: { code: 'RATELIMITED' } });
  });
});
