import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM, TEST_USER, TEST_USER_2 } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentReactionNotFoundError,
  CommentService,
  CommentValidationError,
  extractMentionedUserIds,
} from './comment.service';

const TEST_COMMENT = {
  archivedAt: null,
  authorId: TEST_USER.id,
  body: 'Hello',
  bodyData: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  editedAt: null,
  id: '00000000-0000-0000-0000-000000000700',
  issueId: TEST_ISSUE.id,
  parentId: null,
  resolvedAt: null,
  resolvedById: null,
  updatedAt: new Date('2026-03-01T00:00:00Z'),
};

const TEST_REACTION = {
  commentId: TEST_COMMENT.id,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  emoji: '👍',
  id: '00000000-0000-0000-0000-000000000710',
  userId: TEST_USER.id,
};

describe('CommentService', () => {
  let prisma: MockPrismaClient;
  let service: CommentService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CommentService(prisma as never);
  });

  describe('findAccessTarget', () => {
    it('returns the teamId for a comment in the caller org', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        issue: { organizationId: TEST_ORG.id, teamId: TEST_TEAM.id },
      });

      const result = await service.findAccessTarget(TEST_COMMENT.id, TEST_ORG.id);

      expect(result).toEqual({ teamId: TEST_TEAM.id });
    });

    it('returns null when the comment does not exist', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      expect(await service.findAccessTarget(TEST_COMMENT.id, TEST_ORG.id)).toBeNull();
    });

    it('returns null when the comment belongs to a different org', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        issue: { organizationId: 'other-org', teamId: TEST_TEAM.id },
      });

      expect(await service.findAccessTarget(TEST_COMMENT.id, TEST_ORG.id)).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a top-level comment', async () => {
      prisma.comment.create.mockResolvedValue(TEST_COMMENT);

      const result = await service.create(TEST_USER.id, {
        body: 'Hello',
        issueId: TEST_ISSUE.id,
      });

      expect(result).toEqual(TEST_COMMENT);
      expect(prisma.comment.findUnique).not.toHaveBeenCalled();
      expect(prisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorId: TEST_USER.id,
            body: 'Hello',
            issueId: TEST_ISSUE.id,
            parentId: null,
          }),
        }),
      );
    });

    it('creates a reply when the parent is valid', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        archivedAt: null,
        issueId: TEST_ISSUE.id,
      });
      const reply = { ...TEST_COMMENT, parentId: TEST_COMMENT.id };
      prisma.comment.create.mockResolvedValue(reply);

      const result = await service.create(TEST_USER.id, {
        body: 'A reply',
        issueId: TEST_ISSUE.id,
        parentId: TEST_COMMENT.id,
      });

      expect(result.parentId).toBe(TEST_COMMENT.id);
    });

    it('rejects a reply to a missing parent', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.create(TEST_USER.id, {
          body: 'A reply',
          issueId: TEST_ISSUE.id,
          parentId: 'missing',
        }),
      ).rejects.toThrow(CommentNotFoundError);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it('rejects a reply to an archived parent', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        archivedAt: new Date(),
        issueId: TEST_ISSUE.id,
      });

      await expect(
        service.create(TEST_USER.id, {
          body: 'A reply',
          issueId: TEST_ISSUE.id,
          parentId: TEST_COMMENT.id,
        }),
      ).rejects.toThrow(CommentNotFoundError);
    });

    it('rejects a reply when the parent belongs to another issue', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        archivedAt: null,
        issueId: 'another-issue',
      });

      await expect(
        service.create(TEST_USER.id, {
          body: 'A reply',
          issueId: TEST_ISSUE.id,
          parentId: TEST_COMMENT.id,
        }),
      ).rejects.toThrow(CommentNotFoundError);
    });

    it('rejects a body over the length cap', async () => {
      await expect(
        service.create(TEST_USER.id, {
          body: 'a'.repeat(100_001),
          issueId: TEST_ISSUE.id,
        }),
      ).rejects.toThrow(CommentValidationError);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates the author own comment and stamps editedAt', async () => {
      prisma.comment.findUnique.mockResolvedValue(TEST_COMMENT);
      prisma.comment.update.mockResolvedValue({ ...TEST_COMMENT, body: 'Edited' });

      const result = await service.update(TEST_COMMENT.id, TEST_USER.id, { body: 'Edited' });

      expect(result.body).toBe('Edited');
      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ body: 'Edited', editedAt: expect.any(Date) }),
          where: { id: TEST_COMMENT.id },
        }),
      );
    });

    it('throws NotFound when the comment is missing', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.update(TEST_COMMENT.id, TEST_USER.id, { body: 'x' })).rejects.toThrow(
        CommentNotFoundError,
      );
    });

    it('throws Forbidden when a non-author edits', async () => {
      prisma.comment.findUnique.mockResolvedValue(TEST_COMMENT);

      await expect(service.update(TEST_COMMENT.id, TEST_USER_2.id, { body: 'x' })).rejects.toThrow(
        CommentForbiddenError,
      );
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });

    it('rejects a body over the length cap', async () => {
      await expect(
        service.update(TEST_COMMENT.id, TEST_USER.id, { body: 'a'.repeat(100_001) }),
      ).rejects.toThrow(CommentValidationError);
      expect(prisma.comment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('soft-deletes the author own comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(TEST_COMMENT);
      prisma.comment.update.mockResolvedValue({ ...TEST_COMMENT, archivedAt: new Date() });

      const result = await service.delete(TEST_COMMENT.id, TEST_USER.id);

      expect(result).toEqual({ id: TEST_COMMENT.id });
      expect(prisma.comment.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_COMMENT.id },
      });
    });

    it('throws Forbidden when a non-author deletes', async () => {
      prisma.comment.findUnique.mockResolvedValue(TEST_COMMENT);

      await expect(service.delete(TEST_COMMENT.id, TEST_USER_2.id)).rejects.toThrow(
        CommentForbiddenError,
      );
    });
  });

  describe('resolve / unresolve', () => {
    it('resolve stamps resolvedAt and resolvedById', async () => {
      prisma.comment.findUnique.mockResolvedValue(TEST_COMMENT);
      prisma.comment.update.mockResolvedValue({
        ...TEST_COMMENT,
        resolvedAt: new Date(),
        resolvedById: TEST_USER_2.id,
      });

      await service.resolve(TEST_COMMENT.id, TEST_USER_2.id);

      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { resolvedAt: expect.any(Date), resolvedById: TEST_USER_2.id },
        }),
      );
    });

    it('resolve throws when the comment is missing', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.resolve(TEST_COMMENT.id, TEST_USER.id)).rejects.toThrow(
        CommentNotFoundError,
      );
    });

    it('unresolve clears the resolution fields', async () => {
      prisma.comment.findUnique.mockResolvedValue({ ...TEST_COMMENT, resolvedAt: new Date() });
      prisma.comment.update.mockResolvedValue(TEST_COMMENT);

      await service.unresolve(TEST_COMMENT.id);

      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { resolvedAt: null, resolvedById: null },
        }),
      );
    });
  });

  describe('addReaction', () => {
    it('upserts a reaction on an existing comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(TEST_COMMENT);
      prisma.commentReaction.upsert.mockResolvedValue(TEST_REACTION);

      const result = await service.addReaction(TEST_COMMENT.id, TEST_USER.id, '👍');

      expect(result).toEqual(TEST_REACTION);
      expect(prisma.commentReaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { commentId: TEST_COMMENT.id, emoji: '👍', userId: TEST_USER.id },
          update: {},
          where: {
            commentId_userId_emoji: {
              commentId: TEST_COMMENT.id,
              emoji: '👍',
              userId: TEST_USER.id,
            },
          },
        }),
      );
    });

    it('throws when reacting to a missing comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.addReaction(TEST_COMMENT.id, TEST_USER.id, '👍')).rejects.toThrow(
        CommentNotFoundError,
      );
      expect(prisma.commentReaction.upsert).not.toHaveBeenCalled();
    });
  });

  describe('removeReaction', () => {
    it('deletes an existing reaction', async () => {
      prisma.commentReaction.findUnique.mockResolvedValue(TEST_REACTION);
      prisma.commentReaction.delete.mockResolvedValue(TEST_REACTION);

      const result = await service.removeReaction(TEST_COMMENT.id, TEST_USER.id, '👍');

      expect(result).toEqual({ id: TEST_REACTION.id });
      expect(prisma.commentReaction.delete).toHaveBeenCalledWith({
        where: { id: TEST_REACTION.id },
      });
    });

    it('throws when the reaction does not exist', async () => {
      prisma.commentReaction.findUnique.mockResolvedValue(null);

      await expect(service.removeReaction(TEST_COMMENT.id, TEST_USER.id, '👍')).rejects.toThrow(
        CommentReactionNotFoundError,
      );
      expect(prisma.commentReaction.delete).not.toHaveBeenCalled();
    });
  });
});

describe('extractMentionedUserIds', () => {
  it('returns an empty array for undefined/null/empty bodyData', () => {
    expect(extractMentionedUserIds(undefined)).toEqual([]);
    expect(extractMentionedUserIds(null)).toEqual([]);
    expect(extractMentionedUserIds({})).toEqual([]);
  });

  it('collects mention node ids from a nested ProseMirror doc', () => {
    const doc = {
      content: [
        {
          content: [
            { text: 'Hey ', type: 'text' },
            { attrs: { id: 'user-1', label: 'Alice' }, type: 'mention' },
            { text: ' and ', type: 'text' },
            { attrs: { id: 'user-2', label: 'Bob' }, type: 'mention' },
          ],
          type: 'paragraph',
        },
      ],
      type: 'doc',
    };

    expect(extractMentionedUserIds(doc)).toEqual(['user-1', 'user-2']);
  });

  it('de-duplicates repeated mentions of the same user', () => {
    const doc = {
      content: [
        { attrs: { id: 'user-1' }, type: 'mention' },
        { attrs: { id: 'user-1' }, type: 'mention' },
      ],
      type: 'doc',
    };

    expect(extractMentionedUserIds(doc)).toEqual(['user-1']);
  });

  it('ignores issue (#) and project (~) mention node types', () => {
    const doc = {
      content: [
        { attrs: { id: 'ENG-1' }, type: 'issueMention' },
        { attrs: { id: 'proj-1' }, type: 'projectMention' },
        { attrs: { id: 'user-1' }, type: 'mention' },
      ],
      type: 'doc',
    };

    expect(extractMentionedUserIds(doc)).toEqual(['user-1']);
  });
});
