import type { Favorite, PrismaClient } from '../../generated/prisma';
import { MAX_BULK_OPERATION } from '../lib/limits';

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
 * Confirm `entityId` belongs to a row of `entityType` AND to `orgId`. Single
 * shared implementation used by both `FavoriteService.create` (write-time
 * defense-in-depth) and the GraphQL resolver's read-time check before
 * persisting a Favorite (`resolvers/favorite.ts` imports this directly) —
 * collapses what used to be two hand-synced copies of the same 7-case
 * per-entity-type switch into one model-lookup map. Every model listed in
 * `FavoriteEntityType` carries a direct `organizationId` column.
 */
export async function entityBelongsToOrg(
  prisma: PrismaClient,
  entityType: string,
  entityId: string,
  orgId: string,
): Promise<boolean> {
  const modelsByEntityType = {
    CustomView: prisma.customView,
    Cycle: prisma.cycle,
    Document: prisma.document,
    Initiative: prisma.initiative,
    Issue: prisma.issue,
    Project: prisma.project,
    Team: prisma.team,
  } as unknown as Record<
    FavoriteEntityType,
    { findUnique: (args: unknown) => Promise<{ organizationId: string } | null> }
  >;
  const model = modelsByEntityType[entityType as FavoriteEntityType];
  if (!model) {
    return false;
  }
  const row = await model.findUnique({
    select: { organizationId: true },
    where: { id: entityId },
  });
  return row?.organizationId === orgId;
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

    // Verify the target entity actually belongs to the caller's org BEFORE
    // writing. The GraphQL resolver already checks this at request time
    // (see `entityBelongsToOrg`, imported by resolvers/favorite.ts from
    // this module) — this is defense-in-depth at the actual write
    // boundary, and protects any other caller of this service that skips
    // the resolver's check.
    const belongs = await entityBelongsToOrg(this.prisma, input.entityType, input.entityId, orgId);
    if (!belongs) {
      throw new FavoriteEntityNotInOrgError();
    }

    // The DB unique key is `(userId, entityType, entityId)` — NOT scoped
    // by organizationId (a schema/migration change, out of scope here; see
    // the module doc comment above). Upserting on that key directly would
    // find-and-mutate a favorite belonging to a DIFFERENT org whenever the
    // same user has favorited the same literal entityId in two orgs (an
    // id collision across tenants). Scope the lookup by organizationId
    // ourselves instead of trusting the unique key to do it.
    const existing = await this.prisma.favorite.findFirst({
      where: {
        entityId: input.entityId,
        entityType: input.entityType,
        organizationId: orgId,
        userId,
      },
    });
    if (existing) {
      // Re-favoriting an entity already favorited in this org is
      // idempotent — the existing row's sortOrder is preserved unless the
      // caller explicitly provided a new one.
      if (input.sortOrder === undefined) {
        return existing;
      }
      return this.prisma.favorite.update({
        data: { sortOrder: input.sortOrder },
        where: { id: existing.id },
      });
    }

    try {
      return await this.prisma.favorite.create({
        data: {
          entityId: input.entityId,
          entityType: input.entityType,
          organizationId: orgId,
          sortOrder: input.sortOrder ?? 0,
          userId,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // The physical unique constraint is (userId, entityType, entityId)
        // with no organizationId column. Our org-scoped findFirst above
        // found nothing at the time — but two possible races land here:
        //   1. A concurrent request for the SAME org (double-click,
        //      optimistic-retry) won the race and committed its row
        //      between our findFirst and our create. That's not a real
        //      conflict — the old upsert-based implementation was
        //      idempotent for exactly this case, and losing that
        //      idempotency turned a harmless double-click into a
        //      confusing BAD_USER_INPUT that rolled back the optimistic
        //      UI add.
        //   2. A row for this exact (userId, entityType, entityId) already
        //      exists in a genuinely DIFFERENT org — the real cross-org
        //      conflict this error exists to catch.
        // Re-read (unscoped by org, since we need to see whichever row the
        // unique constraint collided with) to tell the two apart.
        const raced = await this.prisma.favorite.findFirst({
          where: {
            entityId: input.entityId,
            entityType: input.entityType,
            userId,
          },
        });
        if (raced && raced.organizationId === orgId) {
          if (input.sortOrder === undefined) {
            return raced;
          }
          return this.prisma.favorite.update({
            data: { sortOrder: input.sortOrder },
            where: { id: raced.id },
          });
        }
        // Either no row was found (shouldn't happen given P2002, but fail
        // safe) or it belongs to a different org — surface a clear
        // conflict instead of silently falling back to an update that
        // would mutate that other org's row.
        throw new FavoriteCrossOrgConflictError();
      }
      throw err;
    }
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
    // Hard cap mirroring issuesBulkUpdate's bulk-operation limit — an
    // unbounded payload would serialize hundreds of sequential UPDATEs (see
    // the sequential-update comment below) inside one transaction and hold a
    // request slot for minutes.
    if (entries.length > MAX_BULK_OPERATION) {
      throw new FavoriteReorderTooLargeError();
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
      // Sequential updates: Prisma's interactive transaction client
      // serializes commands over a single connection, and concurrent
      // statement issuance (Promise.all) is documented as unsafe — it
      // can throw "Transaction already closed" or apply writes out of
      // order under load. Sequential is correct and fast enough for the
      // worst realistic reorder (<= 100 entries).
      for (const e of entries) {
        await tx.favorite.update({
          data: { sortOrder: e.sortOrder },
          where: { id: e.id },
        });
      }
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

export class FavoriteEntityNotInOrgError extends Error {
  constructor() {
    super('Entity not found in this organization');
    this.name = 'FavoriteEntityNotInOrgError';
  }
}

export class FavoriteCrossOrgConflictError extends Error {
  constructor() {
    super(
      'This entity is already favorited under a different organization (the underlying unique ' +
        'constraint is not yet org-scoped — this requires a migration)',
    );
    this.name = 'FavoriteCrossOrgConflictError';
  }
}

export class FavoriteReorderTooLargeError extends Error {
  constructor() {
    super(`Favorite reorder is capped at ${MAX_BULK_OPERATION} entries per request`);
    this.name = 'FavoriteReorderTooLargeError';
  }
}
