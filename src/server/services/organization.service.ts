import {
  type Organization,
  type OrganizationMember,
  type OrganizationRole,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma';

const URL_KEY_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const VALID_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type OrgRole = (typeof VALID_ROLES)[number];

export interface OrganizationCreateInput {
  name: string;
  urlKey: string;
}

export class InvalidUrlKeyError extends Error {
  constructor() {
    super('URL key must be 3-63 characters, lowercase alphanumeric and hyphens only');
    this.name = 'InvalidUrlKeyError';
  }
}

export class UrlKeyTakenError extends Error {
  constructor() {
    super('This URL key is already taken');
    this.name = 'UrlKeyTakenError';
  }
}

export class InvalidRoleError extends Error {
  constructor() {
    super('Invalid role');
    this.name = 'InvalidRoleError';
  }
}

export class MemberNotFoundError extends Error {
  constructor() {
    super('Member not found');
    this.name = 'MemberNotFoundError';
  }
}

export class OwnerRoleRequiredError extends Error {
  constructor() {
    super('Only an owner can manage another owner');
    this.name = 'OwnerRoleRequiredError';
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must keep at least one owner');
    this.name = 'LastOwnerError';
  }
}

export class CannotRemoveSelfError extends Error {
  constructor() {
    super('You cannot remove yourself from a workspace');
    this.name = 'CannotRemoveSelfError';
  }
}

export class OrganizationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create an organization and the founding `owner` membership atomically.
   * Validates the URL key shape up-front and remaps Prisma's P2002 unique
   * constraint violation to a typed UrlKeyTakenError so resolvers do not
   * have to know about Prisma errors.
   */
  async createWithOwner(userId: string, input: OrganizationCreateInput): Promise<Organization> {
    if (!URL_KEY_RE.test(input.urlKey)) {
      throw new InvalidUrlKeyError();
    }

    try {
      return await this.prisma.$transaction(async tx => {
        const org = await tx.organization.create({
          data: { name: input.name, urlKey: input.urlKey },
        });

        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            role: 'owner',
            userId,
          },
        });

        return org;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new UrlKeyTakenError();
      }
      throw err;
    }
  }

  /**
   * Update a member's role within an organization. The caller is responsible
   * for authorizing the request (typically via requireOrgRole(["owner",
   * "admin"])). Returns the updated membership row so resolvers can emit a
   * SyncAction without re-querying.
   */
  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrganizationRole,
    actorRole: string,
  ): Promise<OrganizationMember> {
    if (!VALID_ROLES.includes(role as OrgRole)) {
      throw new InvalidRoleError();
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) {
      throw new MemberNotFoundError();
    }

    // Only an owner may hand out or take away ownership. The resolver's
    // `requireOrgRole(['owner', 'admin'])` gate alone let an admin promote
    // anyone — including themselves via a second account — to owner, and
    // demote the real owners: a full privilege escalation reachable from
    // the ordinary members list.
    if ((role === 'owner' || membership.role === 'owner') && actorRole !== 'owner') {
      throw new OwnerRoleRequiredError();
    }

    // Demoting the last owner would leave the workspace with nobody able to
    // manage ownership at all — the same reasoning as the last-platform-admin
    // guard in the /admin console.
    if (membership.role === 'owner' && role !== 'owner') {
      await this.assertNotLastOwner(orgId, userId);
    }

    return this.prisma.organizationMember.update({
      data: { role },
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
  }

  /**
   * Remove someone from the organization: drop the org membership and every
   * team membership they hold inside it, atomically.
   *
   * The single writer for membership removal — SCIM deprovisioning
   * (`deactivateUser` / `DELETE /Users/:id`) routes through here too. It
   * used to hand-roll the same two deletes, which meant the two paths had
   * already drifted: an IdP deactivating the sole owner stranded the
   * workspace, because only this side had the last-owner guard.
   * `user.active` is deliberately untouched: that flag is global, and
   * removing someone from one workspace must not sign them out of the
   * others.
   *
   * Returns the removed membership row so the resolver can emit a SyncAction
   * without re-querying a row that no longer exists.
   */
  async removeMember(
    orgId: string,
    userId: string,
    actor: { userId: string; role: string } | null,
  ): Promise<OrganizationMember> {
    // `actor: null` means a system caller — today SCIM deprovisioning, which
    // acts on an IdP's instruction rather than a person's. The interpersonal
    // guards (you can't remove yourself; only an owner manages an owner)
    // don't apply to it, but the structural one does: the last owner guard
    // holds for every caller, because an org with no owner is broken however
    // it got that way.
    if (actor && userId === actor.userId) {
      // Leaving is a different operation with different consequences (you
      // lose your own access, and the last owner leaving strands the
      // workspace), so it is not silently folded into "remove a member".
      throw new CannotRemoveSelfError();
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) {
      throw new MemberNotFoundError();
    }

    if (membership.role === 'owner') {
      if (actor && actor.role !== 'owner') {
        throw new OwnerRoleRequiredError();
      }
      await this.assertNotLastOwner(orgId, userId);
    }

    return this.deleteMembership(orgId, userId);
  }

  /**
   * The caller gives up their own membership.
   *
   * Deliberately a separate entry point from `removeMember`, which refuses
   * self-removal, because the two differ in who bears the consequence:
   * removal is done *to* someone by an admin, leaving is done *by* you and
   * costs you your own access. Folding them together would have meant either
   * dropping `removeMember`'s self-guard — so a mis-click on your own row in
   * the members list silently ejects you — or giving "leave" an admin-only
   * permission check it should not have.
   *
   * What they *do* share is the write: both route through the same
   * transaction, so leaving cascades team memberships exactly like removal
   * and inherits the last-owner guard. An owner may leave only once another
   * owner exists; otherwise the workspace is stranded with no one able to
   * manage it, and — unlike being removed — there is no second party in the
   * room to notice.
   *
   * `user.active` is untouched: this is one workspace, not the account.
   */
  async leaveOrganization(orgId: string, userId: string): Promise<OrganizationMember> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) {
      throw new MemberNotFoundError();
    }
    if (membership.role === 'owner') {
      await this.assertNotLastOwner(orgId, userId);
    }
    return this.deleteMembership(orgId, userId);
  }

  /**
   * The single write shared by removal and leaving. Team memberships go in
   * the same transaction as the org membership: a user left holding team rows
   * in an org they are not a member of is a state every team query would have
   * to defend against.
   */
  private async deleteMembership(orgId: string, userId: string): Promise<OrganizationMember> {
    return this.prisma.$transaction(async tx => {
      await tx.teamMembership.deleteMany({
        where: { team: { organizationId: orgId }, userId },
      });
      return tx.organizationMember.delete({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      });
    });
  }

  private async assertNotLastOwner(orgId: string, userId: string): Promise<void> {
    const otherOwners = await this.prisma.organizationMember.count({
      where: { organizationId: orgId, role: 'owner', userId: { not: userId } },
    });
    if (otherOwners === 0) {
      throw new LastOwnerError();
    }
  }

  async findById(orgId: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id: orgId } });
  }

  /** Look up just the urlKey for slug-derivation paths so callers don't
   *  pull a full org row when they only need one column. */
  async getUrlKey(orgId: string): Promise<string | null> {
    const row = await this.prisma.organization.findUnique({
      select: { urlKey: true },
      where: { id: orgId },
    });
    return row?.urlKey ?? null;
  }

  /** Returns the role string for `userId` in `orgId`, or null if not a
   *  member. Use this when the caller needs to branch on role; for plain
   *  yes/no membership use `isMember`. */
  async getMemberRole(orgId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.organizationMember.findUnique({
      select: { role: true },
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    return row?.role ?? null;
  }

  /** Whether `userId` belongs to `orgId`. Used by membership-gated mutations
   *  that need a yes/no answer without leaking the role. */
  async isMember(orgId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.organizationMember.findUnique({
      select: { id: true },
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    return row !== null;
  }
}
