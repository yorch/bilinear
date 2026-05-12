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
    // Orphan file (no parent issue/project) — treat as inaccessible.
    return null;
  }
}
