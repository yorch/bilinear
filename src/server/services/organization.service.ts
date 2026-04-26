import {
  type Organization,
  type OrganizationMember,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma';

const URL_KEY_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const VALID_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type OrgRole = (typeof VALID_ROLES)[number];

export interface OrganizationCreateInput {
  name: string;
  urlKey: string;
}

export class InvalidUrlKeyError extends Error {
  constructor() {
    super(
      'URL key must be 3-63 characters, lowercase alphanumeric and hyphens only',
    );
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

export class OrganizationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create an organization and the founding `owner` membership atomically.
   * Validates the URL key shape up-front and remaps Prisma's P2002 unique
   * constraint violation to a typed UrlKeyTakenError so resolvers do not
   * have to know about Prisma errors.
   */
  async createWithOwner(
    userId: string,
    input: OrganizationCreateInput,
  ): Promise<Organization> {
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
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
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
    role: string,
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

    return this.prisma.organizationMember.update({
      data: { role },
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
  }

  async findMembers(
    orgId: string,
  ): Promise<Array<{ userId: string; role: string }>> {
    return this.prisma.organizationMember.findMany({
      select: { role: true, userId: true },
      where: { organizationId: orgId },
    });
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
