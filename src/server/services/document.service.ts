import type { Document, PrismaClient } from '../../generated/prisma';

export interface DocumentCreateInput {
  id?: string;
  teamId?: string;
  projectId?: string;
  parentId?: string;
  title: string;
  content?: string;
  icon?: string;
}

export interface DocumentUpdateInput {
  title?: string;
  content?: string;
  icon?: string;
  sortOrder?: number;
  parentId?: string | null;
}

export class DocumentNotFoundError extends Error {
  constructor(id: string) {
    super(`Document not found: ${id}`);
    this.name = 'DocumentNotFoundError';
  }
}

export class DocumentForbiddenError extends Error {
  constructor() {
    super('You do not have permission to perform this action on this document');
    this.name = 'DocumentForbiddenError';
  }
}

export class DocumentService {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({ where: { id } });
  }

  async findByOrg(
    orgId: string,
    filters: { teamId?: string; projectId?: string },
  ): Promise<Document[]> {
    return this.prisma.document.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      where: {
        archivedAt: null,
        organizationId: orgId,
        ...(filters.teamId ? { teamId: filters.teamId } : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
      },
    });
  }

  async create(
    orgId: string,
    creatorId: string,
    input: DocumentCreateInput,
  ): Promise<Document> {
    return this.prisma.document.create({
      data: {
        content: input.content,
        creatorId,
        icon: input.icon,
        id: input.id ?? undefined,
        organizationId: orgId,
        parentId: input.parentId,
        projectId: input.projectId,
        teamId: input.teamId,
        title: input.title,
      },
    });
  }

  async update(id: string, input: DocumentUpdateInput): Promise<Document> {
    const data: Record<string, unknown> = {};

    if (input.title !== undefined) {
      data.title = input.title;
    }
    if (input.content !== undefined) {
      data.content = input.content;
    }
    if (input.icon !== undefined) {
      data.icon = input.icon;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }
    if (input.parentId !== undefined) {
      data.parentId = input.parentId;
    }

    return this.prisma.document.update({
      data,
      where: { id },
    });
  }

  async archive(id: string): Promise<Document> {
    return this.prisma.document.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async delete(id: string, userId: string): Promise<{ id: string }> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) {
      throw new DocumentNotFoundError(id);
    }
    if (doc.creatorId !== userId) {
      throw new DocumentForbiddenError();
    }
    await this.prisma.document.delete({ where: { id } });
    return { id };
  }
}
