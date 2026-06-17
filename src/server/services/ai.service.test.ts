import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { AiDisabledError, AiRequestError, AiService } from './ai.service';

// Build a fake Anthropic Messages API response with a single text block.
function anthropicResponse(text: string, ok = true, status = 200) {
  return {
    json: async () => ({ content: [{ text, type: 'text' }] }),
    ok,
    status,
    text: async () => text,
  } as unknown as Response;
}

describe('AiService', () => {
  let prisma: MockPrismaClient;
  let search: { searchIssues: ReturnType<typeof vi.fn> };
  let svc: AiService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    prisma = createMockPrisma();
    search = { searchIssues: vi.fn() };
    svc = new AiService(prisma as never, search as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.ANTHROPIC_API_KEY = undefined;
  });

  describe('assertEnabled', () => {
    it('throws AiDisabledError when no API key is configured', async () => {
      process.env.ANTHROPIC_API_KEY = '';
      await expect(svc.assertEnabled(TEST_ORG.id)).rejects.toBeInstanceOf(AiDisabledError);
    });

    it('throws AiDisabledError when the org toggle is off', async () => {
      prisma.organization.findUnique.mockResolvedValue({ aiEnabled: false });
      await expect(svc.assertEnabled(TEST_ORG.id)).rejects.toBeInstanceOf(AiDisabledError);
    });

    it('resolves when both key and org toggle are present', async () => {
      prisma.organization.findUnique.mockResolvedValue({ aiEnabled: true });
      await expect(svc.assertEnabled(TEST_ORG.id)).resolves.toBeUndefined();
    });
  });

  describe('suggestTitle', () => {
    it('returns a cleaned, single-line, length-clamped title', async () => {
      fetchMock.mockResolvedValue(anthropicResponse('"Fix the broken login flow"\nextra'));
      const title = await svc.suggestTitle('Users cannot log in after the redirect.');
      expect(title).toBe('Fix the broken login flow');
      // Posts to the Anthropic messages endpoint with the version header.
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/messages');
      expect((init.headers as Record<string, string>)['anthropic-version']).toBeDefined();
    });

    it('rejects an empty description without calling the API', async () => {
      await expect(svc.suggestTitle('   ')).rejects.toBeInstanceOf(AiRequestError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('wraps a non-ok provider response in AiRequestError', async () => {
      fetchMock.mockResolvedValue(anthropicResponse('rate limited', false, 429));
      await expect(svc.suggestTitle('something')).rejects.toBeInstanceOf(AiRequestError);
    });
  });

  describe('summarizeIssue', () => {
    it('summarizes the issue title + description', async () => {
      prisma.issue.findFirst.mockResolvedValue({
        description: 'Long description',
        identifier: 'ENG-1',
        organizationId: TEST_ORG.id,
        title: 'Login bug',
      });
      fetchMock.mockResolvedValue(anthropicResponse('Users hit a login bug after redirect.'));
      const summary = await svc.summarizeIssue(TEST_ORG.id, 'issue-1');
      expect(summary).toBe('Users hit a login bug after redirect.');
    });

    it('throws when the issue is not in the org', async () => {
      prisma.issue.findFirst.mockResolvedValue(null);
      await expect(svc.summarizeIssue(TEST_ORG.id, 'missing')).rejects.toBeInstanceOf(
        AiRequestError,
      );
    });
  });

  describe('findDuplicates', () => {
    it('returns only candidates the model identifies, resolved to rows', async () => {
      prisma.issue.findFirst.mockResolvedValue({
        id: 'target',
        organizationId: TEST_ORG.id,
        title: 'Login fails',
      });
      search.searchIssues.mockResolvedValue([
        { id: 'target', identifier: 'ENG-1', title: 'Login fails' }, // self — filtered out
        { id: 'a', identifier: 'ENG-2', title: 'Cannot log in' },
        { id: 'b', identifier: 'ENG-3', title: 'Unrelated' },
      ]);
      fetchMock.mockResolvedValue(anthropicResponse('ENG-2'));
      const dupes = await svc.findDuplicates(TEST_ORG.id, 'target');
      expect(dupes).toEqual([{ id: 'a', identifier: 'ENG-2', title: 'Cannot log in' }]);
    });

    it('returns [] when there are no candidates (no API call)', async () => {
      prisma.issue.findFirst.mockResolvedValue({
        id: 'target',
        organizationId: TEST_ORG.id,
        title: 'Solo',
      });
      search.searchIssues.mockResolvedValue([{ id: 'target', identifier: 'ENG-1', title: 'Solo' }]);
      const dupes = await svc.findDuplicates(TEST_ORG.id, 'target');
      expect(dupes).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns [] when the model answers "none"', async () => {
      prisma.issue.findFirst.mockResolvedValue({
        id: 'target',
        organizationId: TEST_ORG.id,
        title: 'Login fails',
      });
      search.searchIssues.mockResolvedValue([
        { id: 'a', identifier: 'ENG-2', title: 'Cannot log in' },
      ]);
      fetchMock.mockResolvedValue(anthropicResponse('none'));
      const dupes = await svc.findDuplicates(TEST_ORG.id, 'target');
      expect(dupes).toEqual([]);
    });
  });
});
