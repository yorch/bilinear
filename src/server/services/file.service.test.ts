import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import { FileService } from './file.service';

const OTHER_ORG_ID = '00000000-0000-0000-0000-000000099999';
const ISSUE_ID = '00000000-0000-0000-0000-0000000aaaaa';
const FILE_KEY = 'abc123.png';

const FILE_ROW = {
  createdAt: new Date('2026-04-01T00:00:00Z'),
  id: '00000000-0000-0000-0000-0000000fffff',
  issueId: ISSUE_ID,
  key: FILE_KEY,
  mimeType: 'image/png',
  name: 'screenshot.png',
  projectId: null as string | null,
  size: 1024,
  uploaderId: '00000000-0000-0000-0000-000000000010',
  url: 'https://app/api/uploads/abc123.png',
};

describe('FileService.getIssueFiles', () => {
  let prisma: MockPrismaClient;
  let svc: FileService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new FileService(prisma as never);
  });

  it('returns the file list when the issue belongs to the org', async () => {
    prisma.issue.findFirst.mockResolvedValue({ id: ISSUE_ID });
    prisma.file.findMany.mockResolvedValue([FILE_ROW]);

    const rows = await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id);

    expect(rows).toEqual([FILE_ROW]);
    expect(prisma.issue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ISSUE_ID, organizationId: TEST_ORG.id },
      }),
    );
  });

  it('returns [] (no metadata leak) when the issue belongs to a different org', async () => {
    prisma.issue.findFirst.mockResolvedValue(null);

    const rows = await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id);

    expect(rows).toEqual([]);
    expect(prisma.file.findMany).not.toHaveBeenCalled();
  });
});

describe('FileService.findByKeyInOrg', () => {
  let prisma: MockPrismaClient;
  let svc: FileService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new FileService(prisma as never);
  });

  it('returns null when no file matches the storage key', async () => {
    prisma.file.findFirst.mockResolvedValue(null);

    const result = await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id);

    expect(result).toBeNull();
  });

  it('returns the file when its parent issue belongs to the caller org', async () => {
    prisma.file.findFirst.mockResolvedValue({ ...FILE_ROW });
    prisma.issue.findFirst.mockResolvedValue({ id: ISSUE_ID });

    const result = await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id);

    expect(result).toEqual(FILE_ROW);
  });

  it('returns null when the parent issue belongs to another org', async () => {
    prisma.file.findFirst.mockResolvedValue({ ...FILE_ROW });
    prisma.issue.findFirst.mockResolvedValue(null);

    const result = await svc.findByKeyInOrg(FILE_KEY, OTHER_ORG_ID);

    expect(result).toBeNull();
  });

  it('falls back to project ownership when the file is project-scoped', async () => {
    prisma.file.findFirst.mockResolvedValue({
      ...FILE_ROW,
      issueId: null,
      projectId: '00000000-0000-0000-0000-0000000ddddd',
    });
    prisma.project.findFirst.mockResolvedValue({ id: 'p' });

    const result = await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id);

    expect(result).not.toBeNull();
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
  });

  it('returns null for orphan files with neither parent (fail-closed)', async () => {
    prisma.file.findFirst.mockResolvedValue({
      ...FILE_ROW,
      issueId: null,
      projectId: null,
    });

    const result = await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id);

    expect(result).toBeNull();
  });
});
