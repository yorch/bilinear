import type { Document, Prisma, PrismaClient } from '../../generated/prisma';
import { assertMaxLength, MAX_RICH_TEXT_LENGTH } from '../lib/limits';

/** Documents.title / icon are VarChar(255) — an over-long value is a client error, not a 500. */
const MAX_DOCUMENT_TITLE_LENGTH = 255;

/** Walk bound for the ancestor chain; a legitimate tree is nowhere near this deep. */
const MAX_PARENT_WALK = 100;

/**
 * Who is asking, as far as document visibility goes. `hiddenTeamIds` is the
 * private teams in `orgId` the caller is NOT a member of — the same set the
 * bootstrap/delta paths use (`getSyncVisibility`). A document is visible when
 * it has no team, or its team is not hidden.
 */
export interface DocumentScope {
  hiddenTeamIds: string[];
  orgId: string;
}

export interface DocumentCreateInput {
  content?: string;
  icon?: string;
  id?: string;
  parentId?: string;
  projectId?: string;
  teamId?: string;
  title: string;
}

export interface DocumentUpdateInput {
  content?: string;
  icon?: string;
  parentId?: string | null;
  sortOrder?: number;
  title?: string;
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

export class DocumentInvalidParentError extends Error {
  constructor(message = 'Invalid parent document') {
    super(message);
    this.name = 'DocumentInvalidParentError';
  }
}

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

export class DocumentService {
  constructor(private prisma: PrismaClient) {}

  /** Raw lookup with NO tenant or visibility check — internal use only. */
  async findById(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({ where: { id } });
  }

  /**
   * The document if it is in `scope.orgId` AND not in a private team the caller
   * cannot see; otherwise null (indistinguishable from "does not exist", so a
   * hidden id leaks nothing).
   */
  async findVisibleById(id: string, scope: DocumentScope): Promise<Document | null> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc || doc.organizationId !== scope.orgId) {
      return null;
    }
    if (doc.teamId && scope.hiddenTeamIds.includes(doc.teamId)) {
      return null;
    }
    return doc;
  }

  async findByOrg(
    orgId: string,
    filters: { teamId?: string; projectId?: string; includeArchived?: boolean },
    hiddenTeamIds: string[] = [],
  ): Promise<Document[]> {
    return this.prisma.document.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      where: {
        ...(filters.includeArchived ? {} : { archivedAt: null }),
        organizationId: orgId,
        ...(filters.teamId ? { teamId: filters.teamId } : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        // `NOT IN` never matches NULL, so workspace-scoped rows are admitted
        // explicitly — the same shape as the bootstrap's document query.
        ...(hiddenTeamIds.length > 0
          ? { OR: [{ teamId: null }, { teamId: { notIn: hiddenTeamIds } }] }
          : {}),
      },
    });
  }

  private assertValidFields(input: {
    content?: string | null;
    icon?: string | null;
    title?: string;
  }): void {
    const err = (m: string) => new DocumentValidationError(m);
    assertMaxLength(input.title, MAX_DOCUMENT_TITLE_LENGTH, err, 'title');
    assertMaxLength(input.icon, MAX_DOCUMENT_TITLE_LENGTH, err, 'icon');
    assertMaxLength(input.content, MAX_RICH_TEXT_LENGTH, err, 'content');
  }

  /**
   * Serialise parent-link writes for one org. `assertParent` is check-then-write;
   * without this two concurrent opposite re-parents (A under B, B under A) both
   * pass the cycle check and form a loop. Released at commit/rollback.
   */
  private async lockParentWrites(tx: Pick<PrismaClient, '$queryRaw'>, orgId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`document-parent:${orgId}`}, 0))) AS l`;
  }

  /**
   * A parent must exist in this org, be visible to the caller, live in the same
   * team as the child (a doc tree never straddles teams, and a private-team doc
   * must not be reachable as a parent of a public one), and must not be the child
   * or one of its descendants.
   */
  private async assertParent(
    tx: Pick<PrismaClient, 'document'>,
    scope: DocumentScope,
    parentId: string,
    childId: string | null,
    childTeamId: string | null,
  ): Promise<void> {
    if (childId && parentId === childId) {
      throw new DocumentInvalidParentError('A document cannot be its own parent');
    }
    const parent = await tx.document.findUnique({
      select: { id: true, organizationId: true, parentId: true, teamId: true },
      where: { id: parentId },
    });
    if (
      !parent ||
      parent.organizationId !== scope.orgId ||
      (parent.teamId && scope.hiddenTeamIds.includes(parent.teamId))
    ) {
      throw new DocumentInvalidParentError('Parent document not found');
    }
    if ((parent.teamId ?? null) !== (childTeamId ?? null)) {
      throw new DocumentInvalidParentError('Parent document must belong to the same team');
    }
    const seen = new Set<string>([parent.id]);
    let cursor: string | null = parent.parentId;
    for (let hops = 0; cursor && hops < MAX_PARENT_WALK; hops += 1) {
      if (childId && cursor === childId) {
        throw new DocumentInvalidParentError('Parent cannot be a descendant of the document');
      }
      if (seen.has(cursor)) {
        throw new DocumentInvalidParentError('Parent chain is already cyclic');
      }
      seen.add(cursor);
      const next: { parentId: string | null } | null = await tx.document.findUnique({
        select: { parentId: true },
        where: { id: cursor },
      });
      cursor = next?.parentId ?? null;
    }
  }

  async create(
    orgId: string,
    creatorId: string,
    input: DocumentCreateInput,
    hiddenTeamIds: string[] = [],
  ): Promise<Document> {
    this.assertValidFields(input);
    const scope: DocumentScope = { hiddenTeamIds, orgId };
    if (input.teamId) {
      const team = await this.prisma.team.findUnique({
        select: { organizationId: true },
        where: { id: input.teamId },
      });
      if (!team || team.organizationId !== orgId || hiddenTeamIds.includes(input.teamId)) {
        throw new DocumentNotFoundError(input.teamId);
      }
    }
    if (input.projectId) {
      const project = await this.prisma.project.findUnique({
        select: { organizationId: true },
        where: { id: input.projectId },
      });
      if (!project || project.organizationId !== orgId) {
        throw new DocumentNotFoundError(input.projectId);
      }
    }
    return this.prisma.$transaction(async tx => {
      if (input.parentId) {
        await this.lockParentWrites(tx, orgId);
        await this.assertParent(tx, scope, input.parentId, null, input.teamId ?? null);
      }
      return tx.document.create({
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
    });
  }

  async update(id: string, input: DocumentUpdateInput, scope: DocumentScope): Promise<Document> {
    this.assertValidFields(input);
    const data: Prisma.DocumentUncheckedUpdateInput = {};

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
    if (input.parentId === undefined) {
      return this.prisma.document.update({ data, where: { id } });
    }
    data.parentId = input.parentId;
    const parentId = input.parentId;
    return this.prisma.$transaction(async tx => {
      if (parentId) {
        await this.lockParentWrites(tx, scope.orgId);
        const self = await tx.document.findUnique({
          select: { organizationId: true, teamId: true },
          where: { id },
        });
        if (!self || self.organizationId !== scope.orgId) {
          throw new DocumentNotFoundError(id);
        }
        await this.assertParent(tx, scope, parentId, id, self.teamId);
      }
      return tx.document.update({ data, where: { id } });
    });
  }

  async archive(id: string): Promise<Document> {
    return this.prisma.document.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async unarchive(id: string): Promise<Document> {
    return this.prisma.document.update({
      data: { archivedAt: null },
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
