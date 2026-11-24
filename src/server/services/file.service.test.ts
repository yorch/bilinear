import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { FileService } from './file.service';

const OTHER_ORG_ID = '00000000-0000-0000-0000-000000099999';
const ISSUE_ID = '00000000-0000-0000-0000-0000000aaaaa';
const FILE_KEY = 'abc123.png';
const USER_ID = '00000000-0000-0000-0000-000000000011';
const TEAM_ID = '00000000-0000-0000-0000-0000000000aa';
const ISSUE = { assigneeId: null, creatorId: 'someone-else', id: ISSUE_ID, teamId: TEAM_ID };

/** Make the caller a non-member of a private team (and optionally a guest elsewhere). */
function hidePrivateTeam(prisma: MockPrismaClient, teamId: string) {
  prisma.team.findMany.mockResolvedValue([
    { id: teamId, memberships: [], organizationId: TEST_ORG.id },
  ]);
}

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
    prisma.team.findMany.mockResolvedValue([]);
    prisma.teamMemberRole.findMany.mockResolvedValue([]);
    svc = new FileService(prisma as never);
  });

  it('returns the file list when the issue belongs to the org', async () => {
    prisma.issue.findFirst.mockResolvedValue(ISSUE);
    prisma.file.findMany.mockResolvedValue([FILE_ROW]);

    const rows = await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id, USER_ID);

    expect(rows).toEqual([FILE_ROW]);
    expect(prisma.issue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ISSUE_ID, organizationId: TEST_ORG.id },
      }),
    );
  });

  it('returns [] (no metadata leak) when the issue belongs to a different org', async () => {
    prisma.issue.findFirst.mockResolvedValue(null);

    const rows = await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id, USER_ID);

    expect(rows).toEqual([]);
    expect(prisma.file.findMany).not.toHaveBeenCalled();
  });

  it('returns [] for an issue in a private team the caller is not a member of', async () => {
    prisma.issue.findFirst.mockResolvedValue(ISSUE);
    hidePrivateTeam(prisma, TEAM_ID);
    prisma.file.findMany.mockResolvedValue([FILE_ROW]);

    expect(await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id, USER_ID)).toEqual([]);
    expect(prisma.file.findMany).not.toHaveBeenCalled();
  });

  it('returns [] for a guest on an issue they neither created nor are assigned to', async () => {
    prisma.issue.findFirst.mockResolvedValue(ISSUE);
    prisma.teamMemberRole.findMany.mockResolvedValue([
      { team: { organizationId: TEST_ORG.id }, teamId: TEAM_ID, userId: USER_ID },
    ]);
    expect(await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id, USER_ID)).toEqual([]);
  });

  it('fails closed when the caller is unknown', async () => {
    prisma.issue.findFirst.mockResolvedValue(ISSUE);
    expect(await svc.getIssueFiles(ISSUE_ID, TEST_ORG.id)).toEqual([]);
  });
});

describe('FileService.findByKeyInOrg', () => {
  let prisma: MockPrismaClient;
  let svc: FileService;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.team.findMany.mockResolvedValue([]);
    prisma.teamMemberRole.findMany.mockResolvedValue([]);
    svc = new FileService(prisma as never);
  });

  it('returns null when no file matches the storage key', async () => {
    prisma.file.findFirst.mockResolvedValue(null);

    const result = await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id);

    expect(result).toBeNull();
  });

  it('returns the file when its parent issue belongs to the caller org', async () => {
    prisma.file.findFirst.mockResolvedValue({ ...FILE_ROW });
    prisma.issue.findFirst.mockResolvedValue(ISSUE);

    const result = await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id, USER_ID);

    expect(result).toEqual(FILE_ROW);
  });

  it('refuses the download of an attachment on a private-team issue to a non-member', async () => {
    prisma.file.findFirst.mockResolvedValue({ ...FILE_ROW });
    prisma.issue.findFirst.mockResolvedValue(ISSUE);
    hidePrivateTeam(prisma, TEAM_ID);

    expect(await svc.findByKeyInOrg(FILE_KEY, TEST_ORG.id, USER_ID)).toBeNull();
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
