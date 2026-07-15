import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_TEAM, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { ImportService, MAX_EXPORT_ROWS, MAX_IMPORT_ROWS, parseCsv } from './import.service';

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const { headers, rows } = parseCsv('Title,Priority\nFix bug,High\nAdd feature,Low');
    expect(headers).toEqual(['Title', 'Priority']);
    expect(rows).toEqual([
      ['Fix bug', 'High'],
      ['Add feature', 'Low'],
    ]);
  });

  it('handles quoted fields with commas, newlines, and escaped quotes', () => {
    const csv = 'Title,Desc\n"Fix, urgently","line1\nline2"\n"He said ""hi""",ok';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual(['Fix, urgently', 'line1\nline2']);
    expect(rows[1]).toEqual(['He said "hi"', 'ok']);
  });

  it('ignores trailing blank lines and CRLF', () => {
    const { rows } = parseCsv('Title\r\nA\r\n\r\n');
    expect(rows).toEqual([['A']]);
  });
});

describe('ImportService.importIssues', () => {
  let prisma: MockPrismaClient;
  let issueService: { create: ReturnType<typeof vi.fn> };
  let svc: ImportService;

  beforeEach(() => {
    prisma = createMockPrisma();
    issueService = { create: vi.fn() };
    svc = new ImportService(prisma as never, issueService as never);
  });

  it('creates issues, resolving assignee email and state name', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { user: { email: 'Dev@Example.com', id: 'user-1' } },
    ]);
    prisma.workflowState.findMany.mockResolvedValue([{ id: 'state-todo', name: 'Todo' }]);
    issueService.create.mockImplementation(async (_o, _u, input) => ({
      id: `issue-${input.title}`,
      ...input,
    }));

    // Row 2 has an empty title (but a non-empty cell so it isn't dropped as blank).
    const csv =
      'Name,Owner,Status,Prio\nFix login,dev@example.com,Todo,Urgent\n,someone@example.com,Todo,Low';
    const result = await svc.importIssues(TEST_ORG.id, TEST_USER.id, TEST_TEAM.id, csv, {
      assignee: 'Owner',
      priority: 'Prio',
      state: 'Status',
      title: 'Name',
    });

    expect(result.created).toBe(1);
    // Second row has an empty title → skipped.
    expect(result.skipped).toBe(1);
    expect(issueService.create).toHaveBeenCalledWith(
      TEST_ORG.id,
      TEST_USER.id,
      expect.objectContaining({
        assigneeId: 'user-1', // email matched case-insensitively
        priority: 1, // "Urgent" → 1
        stateId: 'state-todo',
        teamId: TEST_TEAM.id,
        title: 'Fix login',
      }),
    );
  });

  it('records a row error and keeps going when create throws', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([]);
    prisma.workflowState.findMany.mockResolvedValue([]);
    issueService.create
      .mockRejectedValueOnce(new Error('bad state'))
      .mockResolvedValueOnce({ id: 'issue-2' });

    const result = await svc.importIssues(TEST_ORG.id, TEST_USER.id, TEST_TEAM.id, 'Title\nA\nB', {
      title: 'Title',
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain('Row 2');
  });

  it('throws when the title column is missing', async () => {
    await expect(
      svc.importIssues(TEST_ORG.id, TEST_USER.id, TEST_TEAM.id, 'A,B\n1,2', { title: 'Nope' }),
    ).rejects.toThrow(/not found/);
  });

  it('rejects files over the row cap', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Issue ${i}`).join('\n');
    await expect(
      svc.importIssues(TEST_ORG.id, TEST_USER.id, TEST_TEAM.id, `Title\n${rows}`, {
        title: 'Title',
      }),
    ).rejects.toThrow(/Too many rows/);
  });
});

describe('ImportService.exportData', () => {
  let prisma: MockPrismaClient;
  let svc: ImportService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new ImportService(prisma as never, { create: vi.fn() } as never);
  });

  it('caps the query at MAX_EXPORT_ROWS and reports truncated when hit', async () => {
    const rows = Array.from({ length: MAX_EXPORT_ROWS }, (_, i) => ({
      identifier: `ENG-${i}`,
      title: `Issue ${i}`,
    }));
    prisma.issue.findMany.mockResolvedValue(rows);

    const result = (await svc.exportData(TEST_ORG.id)) as {
      issueCount: number;
      truncated: boolean;
    };

    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_EXPORT_ROWS }),
    );
    expect(result.issueCount).toBe(MAX_EXPORT_ROWS);
    expect(result.truncated).toBe(true);
  });

  it('reports truncated=false when under the cap', async () => {
    prisma.issue.findMany.mockResolvedValue([{ identifier: 'ENG-1', title: 'Only issue' }]);

    const result = (await svc.exportData(TEST_ORG.id)) as { truncated: boolean };

    expect(result.truncated).toBe(false);
  });

  it('scopes to a single team when teamId is provided', async () => {
    prisma.issue.findMany.mockResolvedValue([]);

    await svc.exportData(TEST_ORG.id, TEST_TEAM.id);

    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: TEST_ORG.id, teamId: TEST_TEAM.id }),
      }),
    );
  });
});
