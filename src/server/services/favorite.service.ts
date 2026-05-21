import type { Favorite, PrismaClient } from '../../generated/prisma';

export type FavoriteEntityType =
  | 'Issue'
  | 'Project'
  | 'Initiative'
  | 'CustomView'
  | 'Cycle'
  | 'Document'
  | 'Team';

const VALID_ENTITY_TYPES = new Set<FavoriteEntityType>([
  'Issue',
  'Project',
  'Initiative',
  'CustomView',
  'Cycle',
  'Document',
  'Team',
]);

export interface FavoriteCreateInput {
  entityId: string;
  entityType: FavoriteEntityType;
  sortOrder?: number;
}

export interface FavoriteReorderEntry {
  id: string;
  sortOrder: number;
}

/**
 * Sidebar pinning: a Favorite associates one entity (issue, project,
 * initiative, view, cycle, document, team) with a user inside an
 * organization. Uniqueness is on `(userId, entityType, entityId)` so
 * favoriting twice is a no-op; reordering is purely client-driven
 * via `reorder()` to avoid renumbering on every drag.
 */
export class FavoriteService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, userId: string, input: FavoriteCreateInput): Promise<Favorite> {
    if (!VALID_ENTITY_TYPES.has(input.entityType)) {
      throw new FavoriteInvalidEntityTypeError();
    }
    return this.prisma.favorite.upsert({
      create: {
        entityId: input.entityId,
        entityType: input.entityType,
        organizationId: orgId,
        sortOrder: input.sortOrder ?? 0,
        userId,
      },
      // Upsert by the natural key — re-favoriting an entity is idempotent
      // and the existing row's sortOrder is preserved unless the caller
      // explicitly provided a new one.
      update: input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {},
      where: {
        userId_entityType_entityId: {
          entityId: input.entityId,
          entityType: input.entityType,
          userId,
        },
      },
    });
  }

  async delete(orgId: string, userId: string, id: string): Promise<Favorite> {
    const existing = await this.prisma.favorite.findFirst({
      where: { id, organizationId: orgId, userId },
    });
    if (!existing) {
      throw new FavoriteNotFoundError();
    }
    return this.prisma.favorite.delete({ where: { id } });
  }

  /** All favorites for a user inside their current org, ordered for sidebar render. */
  async findByUser(orgId: string, userId: string): Promise<Favorite[]> {
    return this.prisma.favorite.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      where: { organizationId: orgId, userId },
    });
  }

  /**
   * Bulk-update sort orders after a drag-reorder in the sidebar. The
   * resolver should pass the FULL new ordering for atomicity — partial
   * updates would leave gaps. Returns the updated rows in their new order.
   */
  async reorder(
    orgId: string,
    userId: string,
    entries: FavoriteReorderEntry[],
  ): Promise<Favorite[]> {
    if (entries.length === 0) {
      return [];
    }
    return this.prisma.$transaction(async tx => {
      // Verify every row belongs to the caller before touching it — without
      // this a hostile reorder payload could renumber another user's
      // favorites.
      const claim = await tx.favorite.findMany({
        select: { id: true },
        where: {
          id: { in: entries.map(e => e.id) },
          organizationId: orgId,
          userId,
        },
      });
      if (claim.length !== entries.length) {
        throw new FavoriteNotFoundError();
      }
      await Promise.all(
        entries.map(e =>
          tx.favorite.update({
            data: { sortOrder: e.sortOrder },
            where: { id: e.id },
          }),
        ),
      );
      return tx.favorite.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        where: { organizationId: orgId, userId },
      });
    });
  }
}

export class FavoriteNotFoundError extends Error {
  constructor() {
    super('Favorite not found');
    this.name = 'FavoriteNotFoundError';
  }
}

export class FavoriteInvalidEntityTypeError extends Error {
  constructor() {
    super(
      'Favorite entityType must be one of: Issue, Project, Initiative, CustomView, Cycle, Document, Team',
    );
    this.name = 'FavoriteInvalidEntityTypeError';
  }
}
