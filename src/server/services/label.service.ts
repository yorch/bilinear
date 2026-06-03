import type { IssueLabel, PrismaClient } from '../../generated/prisma';

export interface LabelCreateInput {
  color: string;
  description?: string;
  id?: string;
  isGroup?: boolean;
  name: string;
  parentId?: string;
  teamId?: string;
}

export interface LabelUpdateInput {
  color?: string;
  description?: string;
  name?: string;
  parentId?: string | null;
}

const MAX_GROUP_CHILDREN = 250;

export class LabelGroupDepthError extends Error {
  constructor() {
    super('Labels can only be nested one level deep inside a group');
    this.name = 'LabelGroupDepthError';
  }
}

export class LabelGroupCapacityError extends Error {
  constructor() {
    super(`Label groups are capped at ${MAX_GROUP_CHILDREN} children`);
    this.name = 'LabelGroupCapacityError';
  }
}

export class LabelParentNotFoundError extends Error {
  constructor() {
    super('Parent label not found in this organization');
    this.name = 'LabelParentNotFoundError';
  }
}

export class LabelNotFoundError extends Error {
  constructor() {
    super('Label not found');
    this.name = 'LabelNotFoundError';
  }
}

export class LabelService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, creatorId: string, input: LabelCreateInput): Promise<IssueLabel> {
    return this.prisma.$transaction(async tx => {
      if (input.parentId) {
        // Scope the parent to the same org — otherwise a caller could nest a
        // new label under another org's group label (the FK only checks
        // existence, not tenancy).
        const parent = await tx.issueLabel.findFirst({
          select: { parentId: true },
          where: { id: input.parentId, organizationId: orgId },
        });
        if (!parent) {
          throw new LabelParentNotFoundError();
        }
        // Depth guard: the parent must itself be a root label (no grandparent).
        if (parent.parentId) {
          throw new LabelGroupDepthError();
        }
        // Capacity guard: each group may have at most MAX_GROUP_CHILDREN children.
        // Runs inside the transaction to close the TOCTOU window.
        const siblingCount = await tx.issueLabel.count({
          where: { archivedAt: null, parentId: input.parentId },
        });
        if (siblingCount >= MAX_GROUP_CHILDREN) {
          throw new LabelGroupCapacityError();
        }
      }

      return tx.issueLabel.create({
        data: {
          color: input.color,
          creatorId,
          description: input.description,
          id: input.id ?? undefined,
          isGroup: input.isGroup ?? false,
          name: input.name,
          organizationId: orgId,
          parentId: input.parentId,
          teamId: input.teamId,
        },
      });
    });
  }

  async findById(id: string): Promise<IssueLabel | null> {
    return this.prisma.issueLabel.findUnique({ where: { id } });
  }

  async findByOrgId(orgId: string, teamId?: string): Promise<IssueLabel[]> {
    return this.prisma.issueLabel.findMany({
      orderBy: { name: 'asc' },
      where: {
        archivedAt: null,
        organizationId: orgId,
        // Return workspace-global labels + optionally team-scoped ones
        ...(teamId ? { OR: [{ teamId: null }, { teamId }] } : { teamId: null }),
      },
    });
  }

  /**
   * Given a desired set of labelIds, enforce single-select-per-group semantics:
   * if two or more labels share the same group parent, keep only the last one in
   * the input order (caller's intent wins). Returns the deduplicated list.
   * Falls back to the input unchanged when no labels have a parent.
   */
  async enforceSingleSelectPerGroup(labelIds: string[]): Promise<string[]> {
    if (labelIds.length === 0) {
      return [];
    }
    const labels = await this.prisma.issueLabel.findMany({
      select: { id: true, parentId: true },
      where: { id: { in: labelIds } },
    });
    const byId = new Map(labels.map(l => [l.id, l]));
    // Walk the input list in order; last writer per group wins.
    const seenGroup = new Map<string, string>(); // parentId → last labelId
    for (const id of labelIds) {
      const label = byId.get(id);
      if (label?.parentId) {
        seenGroup.set(label.parentId, id);
      }
    }
    // Rebuild preserving input order but dropping superseded siblings.
    const survivorSet = new Set(seenGroup.values());
    return labelIds.filter(id => {
      const label = byId.get(id);
      if (!label?.parentId) {
        return true; // root labels are always kept
      }
      return survivorSet.has(id);
    });
  }

  async update(id: string, input: LabelUpdateInput): Promise<IssueLabel> {
    return this.prisma.$transaction(async tx => {
      // Re-run depth + capacity guards whenever parentId is being set to a group.
      if (input.parentId != null) {
        // Load the label being updated first so we can scope the parent to the
        // same org (a parent from another org must not be linkable) and reuse
        // its parentId for the self-exclusion in the sibling count below.
        const current = await tx.issueLabel.findUnique({
          select: { organizationId: true, parentId: true },
          where: { id },
        });
        // Distinct from LabelParentNotFoundError: this is the label being
        // updated, not its prospective parent. Reachable only under a race
        // (the row is deleted between the resolver's existence check and this
        // transaction); a clear error keeps "label gone" vs "parent gone"
        // distinguishable for clients.
        if (!current) {
          throw new LabelNotFoundError();
        }
        const parent = await tx.issueLabel.findFirst({
          select: { parentId: true },
          where: { id: input.parentId, organizationId: current.organizationId },
        });
        if (!parent) {
          throw new LabelParentNotFoundError();
        }
        if (parent.parentId) {
          throw new LabelGroupDepthError();
        }
        // Exclude self from the sibling count in case this label already belongs
        // to the same group (moving within the group doesn't increase capacity).
        const siblingCount = await tx.issueLabel.count({
          where: {
            archivedAt: null,
            parentId: input.parentId,
            ...(current.parentId === input.parentId ? { id: { not: id } } : {}),
          },
        });
        if (siblingCount >= MAX_GROUP_CHILDREN) {
          throw new LabelGroupCapacityError();
        }
      }

      return tx.issueLabel.update({
        data: {
          color: input.color,
          description: input.description,
          name: input.name,
          parentId: input.parentId,
        },
        where: { id },
      });
    });
  }

  async archive(id: string): Promise<IssueLabel> {
    return this.prisma.issueLabel.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }
}
