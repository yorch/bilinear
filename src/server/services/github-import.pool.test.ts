import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma';
import type { GithubIssuesClient } from '../lib/github-issues-client';
import { GithubImportService } from './github-import.service';

/**
 * Real-Postgres regression for the pool-starvation deadlock: the old importer
 * took a BLOCKING advisory lock inside a transaction, so every concurrent run
 * for one team parked in the lock queue holding a pooled connection; ~10
 * waiters starved the lock holder and every other query in the app.
 *
 * Needs a live Postgres: `GITHUB_IMPORT_PG_URL=postgresql://... yarn vitest run <this file>`.
 */
const enabled = Boolean(process.env.GITHUB_IMPORT_PG_URL);

describe.skipIf(!enabled)('github import against real Postgres', () => {
  const prisma = enabled
    ? new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.GITHUB_IMPORT_PG_URL, max: 10 }),
      })
    : (undefined as never);
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('12 concurrent runs for one team: one proceeds, the rest fail fast, the pool stays free', async () => {
    const orgId = crypto.randomUUID();
    const teamId = crypto.randomUUID();
    const client: GithubIssuesClient = {
      countIssues: async () => 1,
      getUserEmail: async () => null,
      listComments: async () => ({ items: [], truncated: false }),
      // the GitHub network call
      listIssues: async () => {
        await new Promise(r => setTimeout(r, 300));
        return {
          hasNext: false,
          items: [
            {
              assignee: null,
              body: 'b',
              closed_at: null,
              comments: 0,
              created_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/a/b/issues/1',
              labels: [],
              number: 1,
              state: 'open',
              title: 'T',
              user: null,
            },
          ],
        };
      },
    };
    const slowIssueCreate = async () => {
      await new Promise(r => setTimeout(r, 1500)); // holds the lock for a while
      return { id: crypto.randomUUID() };
    };
    const service = new GithubImportService(
      prisma,
      {
        comment: { create: async () => ({}) as never },
        customField: { createDefinition: async () => ({ id: crypto.randomUUID() }) as never },
        issue: { create: slowIssueCreate as never },
        label: { create: async () => ({}) as never, findByOrgId: async () => [] },
      },
      undefined,
      client,
    );

    const started = Date.now();
    const runs = Array.from({ length: 12 }, () =>
      service
        .importPage(orgId, crypto.randomUUID(), teamId, { repo: 'a/b' })
        .then(() => 'ok' as const)
        .catch((e: Error) => e.name),
    );
    await new Promise(r => setTimeout(r, 700)); // all 12 are now past the GitHub fetch
    const t = Date.now();
    await prisma.user.count();
    const unrelatedMs = Date.now() - t;

    const outcomes = await Promise.all(runs);
    expect(unrelatedMs).toBeLessThan(1000);
    expect(outcomes.filter(o => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter(o => o === 'GithubImportBusyError')).toHaveLength(11);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});
