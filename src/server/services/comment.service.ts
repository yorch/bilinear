import type {
  Comment,
  CommentReaction,
  Prisma,
  PrismaClient,
} from '../../generated/prisma';

export interface CommentCreateInput {
  id?: string;
  issueId: string;
  body: string;
  bodyData?: Record<string, unknown>;
  parentId?: string;
}

export interface CommentUpdateInput {
  body?: string;
  bodyData?: Record<string, unknown>;
}

export class CommentNotFoundError extends Error {
  constructor() {
    super('Comment not found');
    this.name = 'CommentNotFoundError';
  }
}

export class CommentForbiddenError extends Error {
  constructor() {
    super('Forbidden: you do not own this comment');
    this.name = 'CommentForbiddenError';
  }
}

export class CommentReactionNotFoundError extends Error {
  constructor() {
    super('Reaction not found');
    this.name = 'CommentReactionNotFoundError';
  }
}

const COMMENT_INCLUDE = {
  author: true,
  reactions: {
    include: { user: true },
    orderBy: { createdAt: 'asc' as const },
  },
  replies: {
    include: {
      author: true,
      reactions: {
        include: { user: true },
        orderBy: { createdAt: 'asc' as const },
      },
      replies: { where: { archivedAt: null } },
      resolvedBy: true,
    },
    orderBy: { createdAt: 'asc' as const },
    where: { archivedAt: null },
  },
  resolvedBy: true,
} as const;

export class CommentService {
  constructor(private prisma: PrismaClient) {}

  async findById(
    id: string,
  ): Promise<
    | (Comment & { author: unknown; reactions: unknown[]; replies: unknown[] })
    | null
  > {
    return this.prisma.comment.findUnique({
      include: COMMENT_INCLUDE,
      where: { id },
    }) as Promise<
      | (Comment & {
          author: unknown;
          reactions: unknown[];
          replies: unknown[];
        })
      | null
    >;
  }

  async findByIssueId(
    issueId: string,
    includeArchived = false,
  ): Promise<Comment[]> {
    return this.prisma.comment.findMany({
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
      where: {
        archivedAt: includeArchived ? undefined : null,
        issueId,
        parentId: null, // top-level only — replies are loaded as nested
      },
    }) as unknown as Comment[];
  }

  async create(
    authorId: string,
    input: CommentCreateInput,
  ): Promise<
    Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }
  > {
    if (input.parentId) {
      const parent = await this.prisma.comment.findUnique({
        select: { archivedAt: true, issueId: true },
        where: { id: input.parentId },
      });
      if (!parent || parent.archivedAt || parent.issueId !== input.issueId) {
        throw new CommentNotFoundError();
      }
    }

    return this.prisma.comment.create({
      data: {
        authorId,
        body: input.body,
        bodyData: (input.bodyData ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        id: input.id ?? undefined,
        issueId: input.issueId,
        parentId: input.parentId ?? null,
      },
      include: COMMENT_INCLUDE,
    }) as unknown as Comment & {
      author: unknown;
      reactions: unknown[];
      replies: unknown[];
    };
  }

  async update(
    id: string,
    userId: string,
    input: CommentUpdateInput,
  ): Promise<
    Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }
  > {
    const existing = await this.prisma.comment.findUnique({ where: { id } });
    if (!existing) {
      throw new CommentNotFoundError();
    }
    if (existing.authorId !== userId) {
      throw new CommentForbiddenError();
    }

    return this.prisma.comment.update({
      data: {
        body: input.body ?? undefined,
        bodyData: (input.bodyData ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        editedAt: new Date(),
      },
      include: COMMENT_INCLUDE,
      where: { id },
    }) as unknown as Comment & {
      author: unknown;
      reactions: unknown[];
      replies: unknown[];
    };
  }

  async delete(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.comment.findUnique({ where: { id } });
    if (!existing) {
      throw new CommentNotFoundError();
    }
    if (existing.authorId !== userId) {
      throw new CommentForbiddenError();
    }

    await this.prisma.comment.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
    return { id };
  }

  async resolve(
    id: string,
    userId: string,
  ): Promise<
    Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }
  > {
    const existing = await this.prisma.comment.findUnique({ where: { id } });
    if (!existing) {
      throw new CommentNotFoundError();
    }

    return this.prisma.comment.update({
      data: { resolvedAt: new Date(), resolvedById: userId },
      include: COMMENT_INCLUDE,
      where: { id },
    }) as unknown as Comment & {
      author: unknown;
      reactions: unknown[];
      replies: unknown[];
    };
  }

  async unresolve(
    id: string,
  ): Promise<
    Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }
  > {
    const existing = await this.prisma.comment.findUnique({ where: { id } });
    if (!existing) {
      throw new CommentNotFoundError();
    }

    return this.prisma.comment.update({
      data: { resolvedAt: null, resolvedById: null },
      include: COMMENT_INCLUDE,
      where: { id },
    }) as unknown as Comment & {
      author: unknown;
      reactions: unknown[];
      replies: unknown[];
    };
  }

  async addReaction(
    commentId: string,
    userId: string,
    emoji: string,
  ): Promise<CommentReaction & { user: unknown }> {
    const existing = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!existing) {
      throw new CommentNotFoundError();
    }

    return this.prisma.commentReaction.upsert({
      create: { commentId, emoji, userId },
      include: { user: true },
      update: {},
      where: { commentId_userId_emoji: { commentId, emoji, userId } },
    }) as unknown as CommentReaction & { user: unknown };
  }

  async removeReaction(
    commentId: string,
    userId: string,
    emoji: string,
  ): Promise<{ id: string }> {
    const reaction = await this.prisma.commentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId, emoji, userId } },
    });
    if (!reaction) {
      throw new CommentReactionNotFoundError();
    }

    await this.prisma.commentReaction.delete({
      where: { id: reaction.id },
    });
    return { id: reaction.id };
  }
}
