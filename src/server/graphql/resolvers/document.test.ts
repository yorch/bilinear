import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ORG } from '../../../test/fixtures';
import { DocumentService } from '../../services/document.service';
import { documentResolvers } from './document';

const DOC = { archivedAt: null, id: 'doc-1', organizationId: TEST_ORG.id };

describe('documentResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
    // The shared mock context predates documents; wire the real service over mock Prisma.
    (ctx.services as Record<string, unknown>).document = new DocumentService(ctx.prisma as never);
  });

  describe('Mutation.documentUnarchive', () => {
    it('throws NOT_FOUND for a document in another org', async () => {
      ctx.prisma.document.findUnique.mockResolvedValue({ ...DOC, organizationId: 'other' });
      await testAuthGuard(
        documentResolvers.Mutation.documentUnarchive,
        { id: DOC.id },
        ctx,
        'NOT_FOUND',
      );
    });

    it('clears archivedAt and creates a SyncAction', async () => {
      ctx.prisma.document.findUnique.mockResolvedValue({ ...DOC, archivedAt: new Date() });
      ctx.prisma.document.update.mockResolvedValue(DOC);
      const createSyncAction = vi.spyOn(ctx.services.sync, 'createSyncAction');

      const res = await documentResolvers.Mutation.documentUnarchive(
        null,
        { id: DOC.id },
        ctx as never,
      );

      expect(ctx.prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { archivedAt: null } }),
      );
      expect(createSyncAction).toHaveBeenCalledWith(TEST_ORG.id, 'U', 'Document', DOC.id, DOC);
      expect(res.lastSyncId).toBe('1');
    });
  });
});
