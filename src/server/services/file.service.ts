import type { PrismaClient, File as PrismaFile } from '../../generated/prisma';

export interface FileCreateInput {
  issueId?: string;
  key: string;
  mimeType: string;
  name: string;
  projectId?: string;
  size: number;
  url: string;
}

/**
 * Avatars are the one upload with no issue/project parent. The server mints
 * their key with this prefix (a client cannot choose a key), which is how a
 * parent-less row is recognised as an avatar without a schema column.
 */
export const AVATAR_KEY_PREFIX = 'avatar-';
export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB

const AVATAR_KEY_PATTERN = new RegExp(
  `^${AVATAR_KEY_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${AVATAR_EXTENSIONS.join('|')})$`,
);

/**
 * The storage key of `url` when it is exactly `<appUrl>/api/uploads/<avatar key>`
 * — same origin, no query/fragment/userinfo — else null.
 */
export function avatarKeyFromUrl(url: string, appUrl: string): string | null {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(appUrl);
  } catch {
    return null;
  }
  if (
    parsed.origin !== base.origin ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }
  const prefix = '/api/uploads/';
  if (!parsed.pathname.startsWith(prefix)) {
    return null;
  }
  const key = parsed.pathname.slice(prefix.length);
  return AVATAR_KEY_PATTERN.test(key) ? key : null;
}

export class FileNotFoundError extends Error {
  constructor() {
    super('File not found');
    this.name = 'FileNotFoundError';
  }
}

export class FileForbiddenError extends Error {
  constructor() {
    super('Forbidden: you do not own this file');
    this.name = 'FileForbiddenError';
  }
}

export class FileService {
  constructor(private prisma: PrismaClient) {}

  async createFile(uploaderId: string, input: FileCreateInput): Promise<PrismaFile> {
    return this.prisma.file.create({
      data: {
        issueId: input.issueId ?? null,
        key: input.key,
        mimeType: input.mimeType,
        name: input.name,
        projectId: input.projectId ?? null,
        size: input.size,
        uploaderId,
        url: input.url,
      },
    });
  }

  async getIssueFiles(issueId: string, orgId: string): Promise<PrismaFile[]> {
    // Scope to the caller's org before returning file metadata. Without this,
    // any authenticated user could enumerate files from any issue in any org.
    const issue = await this.prisma.issue.findFirst({
      select: { id: true },
      where: { id: issueId, organizationId: orgId },
    });
    if (!issue) {
      return [];
    }
    return this.prisma.file.findMany({
      orderBy: { createdAt: 'asc' },
      where: { issueId },
    });
  }

  async deleteFile(fileId: string, userId: string, orgId: string): Promise<PrismaFile> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new FileNotFoundError();
    }
    if (file.uploaderId !== userId) {
      throw new FileForbiddenError();
    }
    // Confirm the file's parent issue/project belongs to orgId — otherwise
    // an uploader who has since left an org could still mutate the row.
    if (file.issueId) {
      const ok = await this.prisma.issue.findFirst({
        select: { id: true },
        where: { id: file.issueId, organizationId: orgId },
      });
      if (!ok) {
        throw new FileForbiddenError();
      }
    } else if (file.projectId) {
      const ok = await this.prisma.project.findFirst({
        select: { id: true },
        where: { id: file.projectId, organizationId: orgId },
      });
      if (!ok) {
        throw new FileForbiddenError();
      }
    } else {
      // Orphan file — refuse rather than allow the legacy uploader-only path
      // to mutate a row that nothing else references.
      throw new FileForbiddenError();
    }

    return this.prisma.file.delete({ where: { id: fileId } });
  }

  /**
   * Fetches a file by its storage key and verifies it belongs to the caller's
   * org via the attached issue or project. Returns null when the file is not
   * found or is cross-org.
   *
   * File has a Prisma relation to Issue but not to Project (see
   * prisma/schema.prisma). We therefore look up the file, then verify
   * ownership via whichever parent is set.
   */
  async findByKeyInOrg(key: string, orgId: string): Promise<PrismaFile | null> {
    const file = await this.prisma.file.findFirst({
      where: { key },
    });
    if (!file) {
      return null;
    }
    if (file.issueId) {
      const ok = await this.prisma.issue.findFirst({
        select: { id: true },
        where: { id: file.issueId, organizationId: orgId },
      });
      return ok ? file : null;
    }
    if (file.projectId) {
      const ok = await this.prisma.project.findFirst({
        select: { id: true },
        where: { id: file.projectId, organizationId: orgId },
      });
      return ok ? file : null;
    }
    // An avatar is shown to everyone the uploader works with, so it is readable
    // from any org the uploader belongs to — and from no other.
    if (file.uploaderId && file.key.startsWith(AVATAR_KEY_PREFIX)) {
      const member = await this.prisma.organizationMember.findFirst({
        select: { userId: true },
        where: { organizationId: orgId, userId: file.uploaderId },
      });
      return member ? file : null;
    }
    // Any other orphan (no parent issue/project) — treat as inaccessible.
    return null;
  }
}
