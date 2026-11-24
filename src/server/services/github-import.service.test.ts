import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import type { GithubIssue, GithubIssuesClient } from '../lib/github-issues-client';
import { GithubInvalidRepoError, parseRepoSlug } from '../lib/github-issues-client';
import {
  buildDescription,
  GITHUB_IMPORT_PAGE_SIZE,
  GithubImportService,
} from './github-import.service';

const TEAM = 'team-1';
const FIELD = { id: 'field-1', name: 'GitHub issue', teamId: TEAM, type: 'url' };

function gh(over: Partial<GithubIssue> = {}): GithubIssue {
  const number = over.number ?? 1;
  return {
    assignee: null,
    body: 'Body text',
    closed_at: null,
    comments: 0,
    created_at: '2025-03-04T10:00:00Z',
    html_url: `https://github.com/acme/app/issues/${number}`,
    labels: [],
    number,
    state: 'open',
    title: `Issue ${number}`,
    user: { login: 'octocat' },
    ...over,
  };
}

describe('parseRepoSlug', () => {
  it('accepts slugs and github URLs', () => {
    expect(parseRepoSlug('acme/app')).toBe('acme/app');
    expect(parseRepoSlug('https://github.com/acme/app.git')).toBe('acme/app');
    expect(parseRepoSlug('https://github.com/acme/app/issues')).toBe('acme/app');
  });
  it('rejects anything that could change the request path', () => {
    for (const bad of ['', 'acme', 'acme/../x', '../../etc/passwd', 'a b/c', 'acme/app?x=1']) {
      expect(() => parseRepoSlug(bad), bad).toThrow(GithubInvalidRepoError);
    }
  });
});

describe('GithubImportService', () => {
  let prisma: MockPrismaClient;
  let client: { [K in keyof GithubIssuesClient]: ReturnType<typeof vi.fn> };
  let deps: {
    comment: { create: ReturnType<typeof vi.fn> };
    customField: { createDefinition: ReturnType<typeof vi.fn> };
    issue: { create: ReturnType<typeof vi.fn> };
    label: { create: ReturnType<typeof vi.fn>; findByOrgId: ReturnType<typeof vi.fn> };
  };
  let service: GithubImportService;
  let txCustomFieldValueCreate: ReturnType<typeof vi.fn>;
  let n: number;

  beforeEach(() => {
    prisma = createMockPrisma();
    n = 0;
    client = {
      countIssues: vi.fn().mockResolvedValue(2),
      getUserEmail: vi.fn().mockResolvedValue(null),
      listComments: vi.fn().mockResolvedValue([]),
      listIssues: vi.fn().mockResolvedValue({ hasNext: false, items: [] }),
    };
    txCustomFieldValueCreate = vi.fn(async ({ data }) => ({ id: `cfv-${data.issueId}`, ...data }));
    deps = {
      comment: { create: vi.fn(async (_a, input) => ({ id: `c-${input.issueId}`, ...input })) },
      customField: { createDefinition: vi.fn().mockResolvedValue(FIELD) },
      issue: {
        // Mirrors IssueService.create: runs the tx hook inside the "transaction".
        create: vi.fn(async (_org, _user, input, hook) => {
          const issue = { id: `i-${++n}`, teamId: input.teamId, title: input.title, ...input };
          await hook?.(
            {
              customFieldValue: { create: txCustomFieldValueCreate },
              issue: { update: vi.fn(async ({ data, where }) => ({ id: where.id, ...data })) },
            },
            issue,
          );
          return issue;
        }),
      },
      label: {
        create: vi.fn(async (_o, _u, input) => ({ id: `l-${input.name}`, ...input })),
        findByOrgId: vi.fn().mockResolvedValue([]),
      },
    };
    prisma.gitHubIntegration.findUnique.mockResolvedValue(null);
    // The per-team advisory lock; a plain no-op here, emulated as a real mutex
    // in the concurrency suite below.
    (prisma as unknown as { $executeRaw: unknown }).$executeRaw = vi.fn();
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.customFieldDefinition.findFirst.mockResolvedValue(FIELD);
    prisma.customFieldValue.findMany.mockResolvedValue([]);
    prisma.workflowState.findMany.mockResolvedValue([
      { id: 's-unstarted', type: 'unstarted' },
      { id: 's-done', type: 'completed' },
      { id: 's-canceled', type: 'canceled' },
    ]);
    prisma.organizationMember.findMany.mockResolvedValue([
      { user: { email: 'Octo@Acme.test', id: 'user-octo' } },
    ]);
    prisma.issueLabelAssignment.findMany.mockResolvedValue([]);
    service = new GithubImportService(prisma as never, deps as never, undefined, client as never);
  });

  const run = (input: Partial<Parameters<GithubImportService['importPage']>[3]> = {}) =>
    service.importPage(TEST_ORG.id, TEST_USER.id, TEAM, { repo: 'acme/app', ...input });

  describe('token handling', () => {
    it('prefers a personal token and never persists it', async () => {
      await service.importPage(TEST_ORG.id, TEST_USER.id, TEAM, {
        repo: 'acme/app',
        token: ' ghp_secret ',
      });
      expect(client.listIssues.mock.calls[0][1]).toBe('ghp_secret');
      expect(prisma.gitHubIntegration.findUnique).not.toHaveBeenCalled();
      for (const model of [
        'gitHubIntegration',
        'customFieldValue',
        'customFieldDefinition',
      ] as const) {
        expect(prisma[model].create).not.toHaveBeenCalled();
        expect(prisma[model].update).not.toHaveBeenCalled();
      }
    });

    it('falls back to the connected integration token', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue({ accessToken: 'gho_integration' });
      const chunk = await run();
      expect(client.listIssues.mock.calls[0][1]).toBe('gho_integration');
      expect(chunk.tokenSource).toBe('integration');
    });

    it('does not let a plain member spend the workspace token (admins only)', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue({ accessToken: 'gho_integration' });
      prisma.organizationMember.findUnique.mockResolvedValue({ role: 'member' });
      const chunk = await run();
      expect(client.listIssues.mock.calls[0][1]).toBeUndefined();
      expect(chunk.tokenSource).toBe('none');
      const preview = await service.preview(TEST_ORG.id, TEST_USER.id, { repo: 'acme/app' });
      expect(client.countIssues.mock.calls[0][1]).toBeUndefined();
      expect(preview.tokenSource).toBe('none');
      // ...but their own PAT still works
      expect((await run({ token: 'ghp_mine' })).tokenSource).toBe('personal');
    });

    it('goes anonymous when neither exists', async () => {
      const chunk = await run();
      expect(client.listIssues.mock.calls[0][1]).toBeUndefined();
      expect(chunk.tokenSource).toBe('none');
    });

    it('reports the token source in the preview', async () => {
      const preview = await service.preview(TEST_ORG.id, TEST_USER.id, {
        repo: 'https://github.com/acme/app',
        token: 'x',
      });
      expect(preview).toEqual({ repo: 'acme/app', tokenSource: 'personal', totalIssues: 2 });
    });
  });

  describe('mapping', () => {
    it('maps open -> team default, closed -> completed, not_planned -> canceled', async () => {
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [
          gh({ number: 1 }),
          gh({ number: 2, state: 'closed', state_reason: 'completed' }),
          gh({ number: 3, state: 'closed', state_reason: 'not_planned' }),
        ],
      });
      await run();
      const stateIds = deps.issue.create.mock.calls.map(c => c[2].stateId);
      expect(stateIds).toEqual([undefined, 's-done', 's-canceled']);
    });

    it('reuses existing labels case-insensitively and creates the missing ones team-scoped', async () => {
      deps.label.findByOrgId.mockResolvedValue([{ id: 'l-bug', name: 'Bug' }]);
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [
          gh({
            labels: [
              { color: 'd73a4a', name: 'bug' },
              { color: 'a2eeef', name: 'Docs' },
            ],
          }),
          gh({ labels: ['docs'], number: 2 }),
        ],
      });
      const chunk = await run();
      expect(deps.label.create).toHaveBeenCalledTimes(1);
      expect(deps.label.create).toHaveBeenCalledWith(TEST_ORG.id, TEST_USER.id, {
        color: '#a2eeef',
        name: 'Docs',
        teamId: TEAM,
      });
      expect(chunk.createdLabels).toHaveLength(1);
      expect(deps.issue.create.mock.calls[0][2].labelIds).toEqual(['l-bug', 'l-Docs']);
      // second issue reuses the label created for the first
      expect(deps.issue.create.mock.calls[1][2].labelIds).toEqual(['l-Docs']);
    });

    it('matches the assignee by the profile email and leaves unmatched ones unassigned', async () => {
      client.getUserEmail.mockImplementation(async (login: string) =>
        login === 'octocat' ? 'octo@acme.test' : login === 'ghost' ? 'ghost@elsewhere.test' : null,
      );
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [
          gh({ assignee: { login: 'octocat' }, number: 1 }),
          gh({ assignee: { login: 'ghost' }, number: 2 }),
          gh({ assignee: { login: 'private' }, number: 3 }),
          gh({ assignee: { login: 'octocat' }, number: 4 }),
        ],
      });
      await run();
      expect(deps.issue.create.mock.calls.map(c => c[2].assigneeId)).toEqual([
        'user-octo',
        undefined,
        undefined,
        'user-octo',
      ]);
      // one profile lookup per distinct login
      expect(client.getUserEmail).toHaveBeenCalledTimes(3);
    });

    it('keeps provenance in the description and truncates oversize titles', async () => {
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [gh({ title: 'x'.repeat(2000) })],
      });
      await run();
      const input = deps.issue.create.mock.calls[0][2];
      expect(input.title).toHaveLength(512);
      expect(input.description).toContain(
        'Imported from GitHub: <a href="https://github.com/acme/app/issues/1"',
      );
      expect(buildDescription(gh({ body: null }))).toContain('@octocat');
    });

    it('stores sanitised HTML, not raw markdown or live GitHub HTML', async () => {
      const html = buildDescription(
        gh({
          body: '# Heading\n\nline 1\nline 2\n\n```\ncode\n```\n\n<img src="https://evil.test/p.gif" onerror="x()">![t](https://evil.test/t.png)',
        }),
      );
      expect(html).toContain('<h1>Heading</h1>');
      expect(html).toContain('<p>line 1<br>line 2</p>');
      expect(html).toContain('<pre><code>code</code></pre>');
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toContain('# Heading');
      expect(html.endsWith('</p>')).toBe(true);
    });

    it('imports comments as HTML with a bold author, not literal asterisks', async () => {
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh({ comments: 1 })] });
      client.listComments.mockResolvedValue({
        items: [
          {
            body: 'hi <script>alert(1)</script>\n\n- a\n- b',
            created_at: '2025-03-05T00:00:00Z',
            id: 1,
            user: { login: 'a' },
          },
        ],
        truncated: false,
      });
      await run({ includeComments: true });
      const body = deps.comment.create.mock.calls[0][1].body as string;
      expect(body).toContain('<strong>@a</strong> commented on 2025-03-05');
      expect(body).not.toContain('**');
      expect(body).not.toContain('<script');
      expect(body).toContain('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    });

    it('preserves GitHub created/closed timestamps instead of stamping now', async () => {
      const issueUpdate = vi.fn(async ({ data, where }) => ({ id: where.id, ...data }));
      deps.issue.create.mockImplementation(async (_o, _u, input, hook) => {
        const issue = { id: `i-${++n}`, ...input };
        await hook?.(
          {
            customFieldValue: { create: txCustomFieldValueCreate },
            issue: { update: issueUpdate },
          },
          issue,
        );
        return issue;
      });
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [
          gh({ number: 1 }),
          gh({ closed_at: '2025-04-01T12:00:00Z', number: 2, state: 'closed' }),
          gh({
            closed_at: '2025-05-02T08:00:00Z',
            number: 3,
            state: 'closed',
            state_reason: 'not_planned',
          }),
        ],
      });
      const chunk = await run();
      const created = new Date('2025-03-04T10:00:00Z');
      expect(issueUpdate.mock.calls.map(c => c[0].data)).toEqual([
        { createdAt: created },
        { completedAt: new Date('2025-04-01T12:00:00Z'), createdAt: created },
        { canceledAt: new Date('2025-05-02T08:00:00Z'), createdAt: created },
      ]);
      // the stamped values reach the SyncAction payload
      expect(chunk.createdIssues[1]).toMatchObject({
        completedAt: new Date('2025-04-01T12:00:00Z'),
      });
    });

    it('closes issues in a canceled-only team and reports closed-as-open when no terminal state exists', async () => {
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [gh({ number: 1, state: 'closed' })],
      });
      prisma.workflowState.findMany.mockResolvedValue([
        { id: 's-unstarted', type: 'unstarted' },
        { id: 's-canceled', type: 'canceled' },
      ]);
      let chunk = await run();
      expect(deps.issue.create.mock.calls[0][2].stateId).toBe('s-canceled');
      expect(chunk.closedAsOpen).toBe(0);

      deps.issue.create.mockClear();
      prisma.customFieldValue.findMany.mockResolvedValue([]);
      prisma.workflowState.findMany.mockResolvedValue([{ id: 's-unstarted', type: 'unstarted' }]);
      chunk = await run();
      expect(deps.issue.create.mock.calls[0][2].stateId).toBeUndefined();
      expect(chunk.closedAsOpen).toBe(1);
    });
  });

  describe('idempotent re-import', () => {
    it('skips issues whose URL is already recorded and reports them as existing', async () => {
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [gh({ number: 1 }), gh({ number: 2 })],
      });
      prisma.customFieldValue.findMany.mockResolvedValue([
        { value: 'https://github.com/acme/app/issues/1' },
      ]);

      const chunk = await run();

      expect(deps.issue.create).toHaveBeenCalledTimes(1);
      expect(deps.issue.create.mock.calls[0][2].title).toBe('Issue 2');
      expect(chunk.existing).toBe(1);
      expect(chunk.createdIssues).toHaveLength(1);
      // the lookup is keyed on the page's URLs and the source field
      expect(prisma.customFieldValue.findMany).toHaveBeenCalledWith({
        select: { value: true },
        where: {
          definitionId: FIELD.id,
          OR: [
            { value: { equals: 'https://github.com/acme/app/issues/1' } },
            { value: { equals: 'https://github.com/acme/app/issues/2' } },
          ],
        },
      });
    });

    it('records the source URL inside the issue-create transaction hook', async () => {
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh({ number: 7 })] });
      const chunk = await run();
      expect(txCustomFieldValueCreate).toHaveBeenCalledWith({
        data: {
          definitionId: FIELD.id,
          issueId: 'i-1',
          value: 'https://github.com/acme/app/issues/7',
        },
      });
      expect(chunk.fieldValues).toHaveLength(1);
    });

    it('creates the source field once, and returns it for syncing', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(null);
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh()] });
      const chunk = await run();
      expect(deps.customField.createDefinition).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'GitHub issue',
          organizationId: TEST_ORG.id,
          teamId: TEAM,
          type: 'url',
        }),
      );
      expect(chunk.createdFieldDefinition).toEqual(FIELD);
    });
  });

  describe('chunking and progress', () => {
    it('requests one fixed-size page and reports nextPage while GitHub has more', async () => {
      client.listIssues.mockResolvedValue({ hasNext: true, items: [gh()] });
      const chunk = await run({ includeClosed: false, page: 3 });
      expect(client.listIssues).toHaveBeenCalledWith('acme/app', undefined, {
        includeClosed: false,
        page: 3,
        perPage: GITHUB_IMPORT_PAGE_SIZE,
      });
      expect(chunk.nextPage).toBe(4);
      expect(chunk.processed).toBe(1);
    });

    it('ends with nextPage null on the last page', async () => {
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh()] });
      expect((await run()).nextPage).toBeNull();
    });

    describe('limits.maxImportRows is per run', () => {
      const capped = () =>
        new GithubImportService(
          prisma as never,
          deps as never,
          { getInt: vi.fn().mockResolvedValue(60) },
          client as never,
        );
      const runCapped = (page: number, startPage?: number) =>
        capped().importPage(TEST_ORG.id, TEST_USER.id, TEAM, {
          page,
          repo: 'acme/app',
          startPage,
        });

      it('stops a run that has walked the cap and says where to resume', async () => {
        const chunk = await runCapped(3);
        expect(chunk.limitReached).toBe(true);
        expect(chunk.nextPage).toBe(3);
        expect(chunk.processed).toBe(0);
        expect(client.listIssues).not.toHaveBeenCalled();
      });

      it('lets a new run starting at the resume page import past the old absolute cap', async () => {
        client.listIssues.mockResolvedValue({ hasNext: true, items: [gh()] });
        const chunk = await runCapped(3, 3);
        expect(chunk.limitReached).toBe(false);
        expect(chunk.nextPage).toBe(4);
        expect(client.listIssues).toHaveBeenCalledTimes(1);
        // ...and the second page of that run is still within the cap
        await runCapped(4, 3);
        expect(client.listIssues).toHaveBeenCalledTimes(2);
        expect((await runCapped(5, 3)).limitReached).toBe(true);
      });
    });
  });

  describe('concurrent runs', () => {
    it('serialise on the team lock: one set of issues and one field definition', async () => {
      // Stateful fakes + a real mutex behind the advisory-lock statement.
      const lockQueues = new Map<string, Promise<void>>();
      const releases: Array<() => void> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        let release: () => void = () => undefined;
        const tx = {
          ...prisma,
          $executeRaw: async (_s: TemplateStringsArray, key: string) => {
            const prev = lockQueues.get(key) ?? Promise.resolve();
            lockQueues.set(
              key,
              new Promise<void>(r => {
                release = r;
              }),
            );
            await prev;
          },
        };
        try {
          return await fn(tx);
        } finally {
          release();
          releases.push(release);
        }
      });
      let definition: typeof FIELD | null = null;
      const recorded = new Set<string>();
      const tick = () => new Promise(r => setTimeout(r, 5));
      prisma.customFieldDefinition.findFirst.mockImplementation(async () => {
        await tick();
        return definition;
      });
      deps.customField.createDefinition.mockImplementation(async () => {
        await tick();
        definition = { ...FIELD };
        return definition;
      });
      prisma.customFieldValue.findMany.mockImplementation(
        async ({ where }: { where: { OR: Array<{ value: { equals: string } }> } }) => {
          await tick();
          return where.OR.filter(o => recorded.has(o.value.equals)).map(o => ({
            value: o.value.equals,
          }));
        },
      );
      deps.issue.create.mockImplementation(async (_o, _u, input, hook) => {
        await tick();
        const issue = { id: `i-${++n}`, ...input };
        recorded.add(`https://github.com/acme/app/issues/${input.title.split(' ')[1]}`);
        await hook?.(
          {
            customFieldValue: { create: txCustomFieldValueCreate },
            issue: { update: async () => issue },
          },
          issue,
        );
        return issue;
      });
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [gh({ number: 1 }), gh({ number: 2 })],
      });

      const [a, b] = await Promise.all([run(), run()]);

      expect(deps.customField.createDefinition).toHaveBeenCalledTimes(1);
      expect(deps.issue.create).toHaveBeenCalledTimes(2);
      expect(a.createdIssues.length + b.createdIssues.length).toBe(2);
      expect(a.existing + b.existing).toBe(2);
    });
  });

  describe('comments and failures', () => {
    it('imports comments only when asked', async () => {
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh({ comments: 2 })] });
      client.listComments.mockResolvedValue({
        items: [
          { body: 'first', created_at: '2025-03-05T00:00:00Z', id: 1, user: { login: 'a' } },
          { body: '  ', created_at: '2025-03-05T00:00:00Z', id: 2, user: null },
        ],
        truncated: false,
      });

      await run({ includeComments: false });
      expect(client.listComments).not.toHaveBeenCalled();

      deps.issue.create.mockClear();
      const chunk = await run({ includeComments: true });
      expect(client.listComments).toHaveBeenCalledWith('acme/app', 1, undefined);
      expect(deps.comment.create).toHaveBeenCalledTimes(1);
      expect(deps.comment.create.mock.calls[0][1].body).toContain(
        '<strong>@a</strong> commented on 2025-03-05',
      );
      expect(chunk.createdComments).toHaveLength(1);
    });

    it('reports comments cut at the per-issue ceiling', async () => {
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh({ comments: 900 })] });
      client.listComments.mockResolvedValue({ items: [], truncated: true });
      const chunk = await run({ includeComments: true });
      expect(chunk.commentsTruncated).toBe(1);
      expect(chunk.errors[0]).toContain('only the first 500 of 900 comments');
    });

    it('records a per-issue failure and keeps going', async () => {
      client.listIssues.mockResolvedValue({
        hasNext: false,
        items: [gh({ number: 1 }), gh({ number: 2 })],
      });
      deps.issue.create.mockRejectedValueOnce(new Error('boom'));
      const chunk = await run();
      expect(chunk.errors).toEqual(['#1: boom']);
      expect(chunk.createdIssues).toHaveLength(1);
    });

    it('surfaces an unusable source field as a clear error', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(null);
      deps.customField.createDefinition.mockRejectedValue(new Error('cap'));
      client.listIssues.mockResolvedValue({ hasNext: false, items: [gh()] });
      await expect(run()).rejects.toMatchObject({ name: 'GithubImportFieldUnavailableError' });
      expect(deps.issue.create).not.toHaveBeenCalled();
    });
  });
});
