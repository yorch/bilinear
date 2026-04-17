import type { PrismaClient, File as PrismaFile } from '../../generated/prisma';

export interface FileCreateInput {
  name: string;
  key: string;
  size: number;
  mimeType: string;
  url: string;
  issueId?: string;
  projectId?: string;
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

  async createFile(
    uploaderId: string,
    input: FileCreateInput,
  ): Promise<PrismaFile> {
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

  async getIssueFiles(issueId: string): Promise<PrismaFile[]> {
    return this.prisma.file.findMany({
      orderBy: { createdAt: 'asc' },
      where: { issueId },
    });
  }

  async deleteFile(fileId: string, userId: string): Promise<PrismaFile> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new FileNotFoundError();
    }
    if (file.uploaderId !== userId) {
      throw new FileForbiddenError();
    }

    return this.prisma.file.delete({ where: { id: fileId } });
  }
}
