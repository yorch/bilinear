import { numericSettingDefault } from '@/lib/config';
import type { IssueLabel, PrismaClient } from '../../generated/prisma';
import { type ConfigReader, DEFAULTS_ONLY_CONFIG } from '../config/reader';

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

/**
 * Registry key for the per-org label-group capacity. The numeric default (250)
 * lives in `src/lib/config/registry.ts` — the constant that used to sit here is
 * gone so there is exactly one place to change it.
 */
const MAX_GROUP_CHILDREN_KEY = 'limits.maxLabelGroupChildren';

export class LabelGroupDepthError extends Error {
  constructor() {
    super('Labels can only be nested one level deep inside a group');
    this.name = 'LabelGroupDepthError';
  }
}

export class LabelGroupCapacityError extends Error {
  constructor(cap: number = numericSettingDefault(MAX_GROUP_CHILDREN_KEY)) {
    super(`Label groups are capped at ${cap} children`);
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
  constructor(
    private prisma: PrismaClient,
    private config: ConfigReader = DEFAULTS_ONLY_CONFIG,
  ) {}

  async create(orgId: string, creatorId: string, input: LabelCreateInput): Promise<IssueLabel> {
    const cap = await this.groupCapacityFor(orgId, input.parentId);

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
        // Capacity guard: each group may have at most the org's configured
        // cap (`limits.maxLabelGroupChildren`) of children. The count runs
        // inside the transaction to close the TOCTOU window; the cap was
        // resolved above it, for the reason given there.
        const siblingCount = await tx.issueLabel.count({
          where: { archivedAt: null, parentId: input.parentId },
        });
        if (cap !== null && siblingCount >= cap) {
          throw new LabelGroupCapacityError(cap);
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

  /**
   * The org's configured label-group capacity, resolved through the config
   * chain (platform default → org override). Previously a per-call
   * `organization.findUnique` — the resolver loads the whole scope once and
   * memoises it, so this is no longer a round-trip per check.
   *
   * `tx` is no longer used and the parameter is gone; the transaction had only
   * ever been threaded through to read a column that is no longer there.
   */
  private async getMaxGroupChildren(orgId: string): Promise<number> {
    return this.config.getInt(MAX_GROUP_CHILDREN_KEY, { orgId });
  }

  /**
   * The group-capacity cap, resolved **before** any transaction opens, and only
   * when a parent is actually being set.
   *
   * `this.config` reads on `this.prisma` — a different pool connection — so a
   * cache miss inside a transaction would hold one connection while asking for
   * a second. At the pool's default of 10, enough concurrent label writes
   * deadlock until every transaction times out. The cap is not transactional
   * data; the TOCTOU guard is the sibling count, which stays inside.
   *
   * Returns `null` when no parent is being set, so a caller that reads it
   * outside the `parentId` branch gets something that cannot be mistaken for a
   * capacity of zero.
   */
  private async groupCapacityFor(
    orgId: string,
    parentId: string | null | undefined,
  ): Promise<number | null> {
    return parentId != null ? this.getMaxGroupChildren(orgId) : null;
  }

  /**
   * `orgId` is passed in rather than read from the row for one reason: the cap
   * has to be resolved BEFORE the transaction opens (see `groupCapacityFor`),
   * and the row's org is not known until the transaction reads it. The caller
   * has it already — `labelUpdate` loads the label and checks tenancy before
   * calling — so taking it as a parameter avoids a second lookup, and matches
   * how `requireTeamMember` takes an explicit org rather than inferring one.
   */
  async update(id: string, orgId: string, input: LabelUpdateInput): Promise<IssueLabel> {
    const cap = await this.groupCapacityFor(orgId, input.parentId);

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
        if (cap !== null && siblingCount >= cap) {
          throw new LabelGroupCapacityError(cap);
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
