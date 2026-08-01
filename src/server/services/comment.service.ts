import type { Comment, CommentReaction, Prisma, PrismaClient } from '../../generated/prisma';
import { assertMaxLength, MAX_RICH_TEXT_LENGTH } from '../lib/limits';

export interface CommentCreateInput {
  body: string;
  bodyData?: Record<string, unknown>;
  id?: string;
  issueId: string;
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

export class CommentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentValidationError';
  }
}

function assertValidBody(body: string | undefined): void {
  assertMaxLength(body, MAX_RICH_TEXT_LENGTH, msg => new CommentValidationError(msg), 'body');
}

/**
 * Walks a TipTap/ProseMirror document (as JSON) collecting the userIds of
 * every `@user` mention node — see `buildMentionExtension` in
 * tiptap-editor.tsx, which stamps `{ type: 'mention', attrs: { id, label } }`
 * nodes into the doc. Issue (`#`) and project (`~`) mentions use different
 * node names (`issueMention`/`projectMention`) and are intentionally not
 * treated as user mentions here. Best-effort: unrecognised/malformed JSON
 * shapes are simply skipped rather than throwing, since bodyData is
 * client-authored editor state, not a validated input contract.
 */
export function extractMentionedUserIds(bodyData: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const n = node as { attrs?: { id?: unknown }; content?: unknown; type?: unknown };
    if (n.type === 'mention' && typeof n.attrs?.id === 'string') {
      ids.add(n.attrs.id);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        walk(child);
      }
    }
  };
  walk(bodyData);
  return Array.from(ids);
}

/**
 * Result of a comment access check — `commentId` is known to belong to an
 * issue inside `orgId` on `teamId`. Resolver still owes a `requireTeamMember`
 * call against teamId; this method does not perform that auth step itself
 * because it doesn't know the caller userId.
 */
export interface CommentAccessTarget {
  teamId: string;
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

  /**
   * Look up the (orgId, teamId) the comment belongs to via its issue. Returns
   * null when the comment does not exist or belongs to a different org —
   * resolvers translate null into NOT_FOUND and chain a requireTeamMember
   * check against the returned teamId.
   */
  async findAccessTarget(commentId: string, orgId: string): Promise<CommentAccessTarget | null> {
    const row = await this.prisma.comment.findUnique({
      select: { issue: { select: { organizationId: true, teamId: true } } },
      where: { id: commentId },
    });
    const issue = row?.issue;
    if (!issue || issue.organizationId !== orgId || !issue.teamId) {
      return null;
    }
    return { teamId: issue.teamId };
  }

  async findById(
    id: string,
  ): Promise<(Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }) | null> {
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

  async findByIssueId(issueId: string, includeArchived = false): Promise<Comment[]> {
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
  ): Promise<Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }> {
    assertValidBody(input.body);

    if (input.parentId) {
      const parent = await this.prisma.comment.findUnique({
        select: { archivedAt: true, issueId: true, parentId: true },
        where: { id: input.parentId },
      });
      if (!parent || parent.archivedAt || parent.issueId !== input.issueId) {
        throw new CommentNotFoundError();
      }
      // Threads are exactly one level deep. `COMMENT_INCLUDE` hydrates two
      // levels of relations, so a grandchild would come back with no `author`
      // — and `Comment.author` is `User!`, which nulls the reply, then its
      // parent, then the whole non-null `comments` list, then `data`. The UI
      // enforces the same rule (quote-reply is gated on the top level), so
      // deeper nesting has no client that can render it either.
      if (parent.parentId) {
        throw new CommentValidationError('Replies cannot be nested more than one level deep');
      }
    }

    return this.prisma.comment.create({
      data: {
        authorId,
        body: input.body,
        bodyData: (input.bodyData ?? undefined) as Prisma.InputJsonValue | undefined,
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
  ): Promise<Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }> {
    assertValidBody(input.body);

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
        bodyData: (input.bodyData ?? undefined) as Prisma.InputJsonValue | undefined,
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
  ): Promise<Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }> {
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
  ): Promise<Comment & { author: unknown; reactions: unknown[]; replies: unknown[] }> {
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

  async removeReaction(commentId: string, userId: string, emoji: string): Promise<{ id: string }> {
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
