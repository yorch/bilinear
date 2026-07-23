import { type Organization, Prisma, type PrismaClient, type User } from '../../generated/prisma';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../lib/limits';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'platform-admin' });

/**
 * Cross-tenant operations for the platform-admin console. Every method here
 * deliberately queries across organizations — the orgId tenant-scoping that
 * governs the rest of the app does NOT apply. That is only safe because every
 * caller is gated by `requirePlatformAdmin` at the resolver/route boundary.
 */

const RECENT_WINDOW_DAYS = 7;
const MONTH_WINDOW_DAYS = 30;
const TOP_ORGS = 5;

export type PlatformAuditAction =
  | 'tenant.suspended'
  | 'tenant.restored'
  | 'tenant.deleted'
  | 'tenant.limits_updated'
  | 'user.suspended'
  | 'user.reactivated'
  | 'user.platform_admin_granted'
  | 'user.platform_admin_revoked'
  | 'user.impersonated'
  | 'user.impersonation_ended';

export interface TenantSummary {
  archivedAt: Date | null;
  createdAt: Date;
  dataRegion: string;
  id: string;
  issueCount: number;
  logoUrl: string | null;
  memberCount: number;
  name: string;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  urlKey: string;
}

export interface TenantOwner {
  displayName: string;
  email: string;
  id: string;
}

/**
 * Per-org plan-tier caps (the `Organization.max*` columns). These default to
 * the old hard-coded constants, so an org's behavior is unchanged until a
 * platform admin edits them here. `Team.upcomingCycleCount` is deliberately
 * excluded — it's a per-team knob, not an org-wide plan limit.
 */
export interface TenantLimits {
  maxCustomFieldsPerOrg: number;
  maxCustomFieldsPerTeam: number;
  maxExportRows: number;
  maxInitiativeDepth: number;
  maxLabelGroupChildren: number;
}

// Accepted range for each cap. Min 1 (a 0 cap would brick the feature); the
// max is a generous ceiling that blocks fat-finger/abuse values (e.g. an
// export cap of a billion rows) while leaving ample headroom above every
// default. Validated in `updateTenantLimits`.
const TENANT_LIMIT_BOUNDS: Record<keyof TenantLimits, { min: number; max: number }> = {
  maxCustomFieldsPerOrg: { max: 1000, min: 1 },
  maxCustomFieldsPerTeam: { max: 1000, min: 1 },
  maxExportRows: { max: 1_000_000, min: 1 },
  maxInitiativeDepth: { max: 20, min: 1 },
  maxLabelGroupChildren: { max: 10_000, min: 1 },
};

export interface TenantDetail extends TenantSummary {
  limits: TenantLimits;
  owners: TenantOwner[];
  projectCount: number;
  teamCount: number;
}

export interface PlatformUserOrg {
  id: string;
  name: string;
  role: string;
  urlKey: string;
}

export interface PlatformUserSummary {
  active: boolean;
  createdAt: Date;
  displayName: string;
  email: string;
  id: string;
  isPlatformAdmin: boolean;
  lastSeen: Date | null;
  organizations: PlatformUserOrg[];
}

export interface PlatformMetrics {
  activeOrgs: number;
  activeUsers: number;
  newOrgs7d: number;
  newOrgs30d: number;
  newUsers7d: number;
  newUsers30d: number;
  platformAdmins: number;
  suspendedOrgs: number;
  suspendedUsers: number;
  topOrgs: Array<{
    id: string;
    name: string;
    urlKey: string;
    issueCount: number;
    memberCount: number;
  }>;
  totalIssues: number;
  totalOrgs: number;
  totalUsers: number;
}

export interface ImpersonationTarget {
  org: Organization;
  user: User;
}

export class TenantNotFoundError extends Error {
  constructor() {
    super('Tenant not found');
    this.name = 'TenantNotFoundError';
  }
}

export class PlatformUserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'PlatformUserNotFoundError';
  }
}

export class LastPlatformAdminError extends Error {
  constructor() {
    super('Cannot revoke the last platform admin');
    this.name = 'LastPlatformAdminError';
  }
}

export class InvalidTenantLimitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTenantLimitsError';
  }
}

export class ImpersonationTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpersonationTargetError';
  }
}

function clampLimit(limit?: number | null): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIST_LIMIT);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export class PlatformAdminService {
  constructor(private prisma: PrismaClient) {}

  async listTenants(params: {
    query?: string | null;
    includeArchived?: boolean | null;
    limit?: number | null;
  }): Promise<TenantSummary[]> {
    const where: Prisma.OrganizationWhereInput = {};
    if (!params.includeArchived) {
      where.archivedAt = null;
    }
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { urlKey: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.organization.findMany({
      include: { _count: { select: { issues: true, members: true } } },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(params.limit),
      where,
    });

    return rows.map(row => this.toTenantSummary(row));
  }

  async getTenant(id: string): Promise<TenantDetail | null> {
    const row = await this.prisma.organization.findUnique({
      include: {
        _count: { select: { issues: true, members: true, projects: true, teams: true } },
        members: {
          include: { user: { select: { displayName: true, email: true, id: true } } },
          where: { role: 'owner' },
        },
      },
      where: { id },
    });
    if (!row) {
      return null;
    }
    return {
      ...this.toTenantSummary(row),
      limits: {
        maxCustomFieldsPerOrg: row.maxCustomFieldsPerOrg,
        maxCustomFieldsPerTeam: row.maxCustomFieldsPerTeam,
        maxExportRows: row.maxExportRows,
        maxInitiativeDepth: row.maxInitiativeDepth,
        maxLabelGroupChildren: row.maxLabelGroupChildren,
      },
      owners: row.members.map(m => ({
        displayName: m.user.displayName,
        email: m.user.email,
        id: m.user.id,
      })),
      projectCount: row._count.projects,
      teamCount: row._count.teams,
    };
  }

  /**
   * Overwrite an org's per-org plan-tier caps. Every field is required (the
   * admin form submits the full set) and validated against
   * `TENANT_LIMIT_BOUNDS`; an out-of-range or non-integer value rejects the
   * whole update so a tenant can never be left with a partially-applied or
   * nonsensical cap. Audit logging is the caller's (resolver's) job.
   */
  async updateTenantLimits(id: string, limits: TenantLimits): Promise<Organization> {
    await this.assertTenantExists(id);
    for (const key of Object.keys(TENANT_LIMIT_BOUNDS) as Array<keyof TenantLimits>) {
      const value = limits[key];
      const { min, max } = TENANT_LIMIT_BOUNDS[key];
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new InvalidTenantLimitsError(`${key} must be an integer between ${min} and ${max}`);
      }
    }
    return this.prisma.organization.update({
      data: {
        maxCustomFieldsPerOrg: limits.maxCustomFieldsPerOrg,
        maxCustomFieldsPerTeam: limits.maxCustomFieldsPerTeam,
        maxExportRows: limits.maxExportRows,
        maxInitiativeDepth: limits.maxInitiativeDepth,
        maxLabelGroupChildren: limits.maxLabelGroupChildren,
      },
      where: { id },
    });
  }

  async suspendTenant(id: string, reason: string | null): Promise<Organization> {
    await this.assertTenantExists(id);
    return this.prisma.organization.update({
      data: { suspendedAt: new Date(), suspendedReason: reason?.trim() || null },
      where: { id },
    });
  }

  async restoreTenant(id: string): Promise<Organization> {
    await this.assertTenantExists(id);
    return this.prisma.organization.update({
      data: { suspendedAt: null, suspendedReason: null },
      where: { id },
    });
  }

  /** Soft-delete: sets archivedAt. Data is retained and members lose access. */
  async deleteTenant(id: string): Promise<Organization> {
    await this.assertTenantExists(id);
    return this.prisma.organization.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async listUsers(params: {
    query?: string | null;
    limit?: number | null;
  }): Promise<PlatformUserSummary[]> {
    const where: Prisma.UserWhereInput = {};
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      include: {
        orgMemberships: {
          include: { organization: { select: { id: true, name: true, urlKey: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(params.limit),
      where,
    });

    return rows.map(row => this.toUserSummary(row));
  }

  async getUser(id: string): Promise<PlatformUserSummary | null> {
    const row = await this.prisma.user.findUnique({
      include: {
        orgMemberships: {
          include: { organization: { select: { id: true, name: true, urlKey: true } } },
        },
      },
      where: { id },
    });
    return row ? this.toUserSummary(row) : null;
  }

  async setUserActive(id: string, active: boolean): Promise<User> {
    await this.assertUserExists(id);
    // Suspending a user sets active=false, and an inactive user fails the
    // `requirePlatformAdmin` gate (extractAuthContext logs them out). So
    // suspending the last *active* platform admin would brick the console
    // with no way back — guard against it, mirroring the setPlatformAdmin
    // last-admin check.
    if (!active) {
      const target = await this.prisma.user.findUnique({
        select: { isPlatformAdmin: true },
        where: { id },
      });
      if (target?.isPlatformAdmin) {
        const activeAdmins = await this.prisma.user.count({
          where: { active: true, isPlatformAdmin: true },
        });
        if (activeAdmins <= 1) {
          throw new LastPlatformAdminError();
        }
      }
    }
    return this.prisma.user.update({ data: { active }, where: { id } });
  }

  async setPlatformAdmin(id: string, value: boolean): Promise<User> {
    await this.assertUserExists(id);
    // Guard against locking everyone out: never revoke the final admin.
    if (!value) {
      const adminCount = await this.prisma.user.count({ where: { isPlatformAdmin: true } });
      const target = await this.prisma.user.findUnique({
        select: { isPlatformAdmin: true },
        where: { id },
      });
      if (target?.isPlatformAdmin && adminCount <= 1) {
        throw new LastPlatformAdminError();
      }
    }
    return this.prisma.user.update({ data: { isPlatformAdmin: value }, where: { id } });
  }

  async getMetrics(): Promise<PlatformMetrics> {
    const now7 = daysAgo(RECENT_WINDOW_DAYS);
    const now30 = daysAgo(MONTH_WINDOW_DAYS);
    const [
      totalOrgs,
      suspendedOrgs,
      activeOrgs,
      totalUsers,
      activeUsers,
      platformAdmins,
      totalIssues,
      newUsers7d,
      newUsers30d,
      newOrgs7d,
      newOrgs30d,
      topOrgRows,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { suspendedAt: { not: null } } }),
      // Count active orgs directly rather than subtracting suspended+archived:
      // an org can be BOTH suspended and archived (delete doesn't clear the
      // suspend flag), so subtraction would double-count it.
      this.prisma.organization.count({ where: { archivedAt: null, suspendedAt: null } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.user.count({ where: { isPlatformAdmin: true } }),
      this.prisma.issue.count(),
      this.prisma.user.count({ where: { createdAt: { gte: now7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: now30 } } }),
      this.prisma.organization.count({ where: { createdAt: { gte: now7 } } }),
      this.prisma.organization.count({ where: { createdAt: { gte: now30 } } }),
      this.prisma.organization.findMany({
        include: { _count: { select: { issues: true, members: true } } },
        orderBy: { issues: { _count: 'desc' } },
        take: TOP_ORGS,
        where: { archivedAt: null },
      }),
    ]);

    return {
      activeOrgs,
      activeUsers,
      newOrgs7d,
      newOrgs30d,
      newUsers7d,
      newUsers30d,
      platformAdmins,
      suspendedOrgs,
      suspendedUsers: totalUsers - activeUsers,
      topOrgs: topOrgRows.map(o => ({
        id: o.id,
        issueCount: o._count.issues,
        memberCount: o._count.members,
        name: o.name,
        urlKey: o.urlKey,
      })),
      totalIssues,
      totalOrgs,
      totalUsers,
    };
  }

  /**
   * Validate that `targetUserId` can be impersonated in `orgId` (or, when
   * orgId is omitted, in their earliest-joined org) and return the resolved
   * user + org. Throws ImpersonationTargetError on any mismatch so a platform
   * admin can never mint a token for a user/org pair that doesn't exist.
   */
  async resolveImpersonationTarget(
    targetUserId: string,
    orgId?: string | null,
  ): Promise<ImpersonationTarget> {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new ImpersonationTargetError('User not found');
    }
    if (!user.active) {
      throw new ImpersonationTargetError('Cannot impersonate a suspended user');
    }

    // When the admin names an org, resolve exactly that one and report
    // honestly if it's suspended. When they don't, pick the target's oldest
    // *enterable* org rather than their oldest org outright: for a multi-org
    // user whose first workspace happens to be suspended, the unfiltered
    // pick made "impersonate this user" fail with "target organization is
    // suspended" even though every other workspace they belong to was fine.
    const membership = orgId
      ? await this.prisma.organizationMember.findFirst({
          include: { organization: true },
          where: { organizationId: orgId, userId: targetUserId },
        })
      : await this.prisma.organizationMember.findFirst({
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
          where: {
            organization: { archivedAt: null, suspendedAt: null },
            userId: targetUserId,
          },
        });
    if (!membership) {
      throw new ImpersonationTargetError('User is not a member of the target organization');
    }
    if (membership.organization.suspendedAt || membership.organization.archivedAt) {
      throw new ImpersonationTargetError('Target organization is suspended');
    }

    return { org: membership.organization, user };
  }

  async recordAudit(input: {
    actorId: string | null;
    action: PlatformAuditAction;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.platformAuditLog.create({
        data: {
          action: input.action,
          actorId: input.actorId,
          ipAddress: input.ipAddress ?? null,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
          targetId: input.targetId ?? null,
          targetType: input.targetType ?? null,
        },
      });
    } catch (err) {
      // Audit logging is best-effort — never break the primary action — but a
      // silently-failing security trail is dangerous, so surface it to logs.
      log.error(
        { action: input.action, actorId: input.actorId, err },
        'failed to write platform audit log entry',
      );
    }
  }

  async listAuditLog(params: { limit?: number | null; cursor?: string | null }) {
    const limit = clampLimit(params.limit);
    const where: Prisma.PlatformAuditLogWhereInput = {};
    if (params.cursor) {
      where.createdAt = { lt: new Date(params.cursor) };
    }
    const rows = await this.prisma.platformAuditLog.findMany({
      include: { actor: { select: { displayName: true, email: true, id: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      where,
    });
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && entries.length > 0
        ? (entries[entries.length - 1]?.createdAt.toISOString() ?? null)
        : null;
    return { entries, hasMore, nextCursor };
  }

  private async assertTenantExists(id: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      select: { id: true },
      where: { id },
    });
    if (!org) {
      throw new TenantNotFoundError();
    }
  }

  private async assertUserExists(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ select: { id: true }, where: { id } });
    if (!user) {
      throw new PlatformUserNotFoundError();
    }
  }

  private toTenantSummary(row: {
    id: string;
    name: string;
    urlKey: string;
    logoUrl: string | null;
    dataRegion: string;
    suspendedAt: Date | null;
    suspendedReason: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    _count: { members: number; issues: number };
  }): TenantSummary {
    return {
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      dataRegion: row.dataRegion,
      id: row.id,
      issueCount: row._count.issues,
      logoUrl: row.logoUrl,
      memberCount: row._count.members,
      name: row.name,
      suspendedAt: row.suspendedAt,
      suspendedReason: row.suspendedReason,
      urlKey: row.urlKey,
    };
  }

  private toUserSummary(row: {
    id: string;
    email: string;
    displayName: string;
    active: boolean;
    isPlatformAdmin: boolean;
    lastSeen: Date | null;
    createdAt: Date;
    orgMemberships: Array<{
      role: string;
      organization: { id: string; name: string; urlKey: string };
    }>;
  }): PlatformUserSummary {
    return {
      active: row.active,
      createdAt: row.createdAt,
      displayName: row.displayName,
      email: row.email,
      id: row.id,
      isPlatformAdmin: row.isPlatformAdmin,
      lastSeen: row.lastSeen,
      organizations: row.orgMemberships.map(m => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
        urlKey: m.organization.urlKey,
      })),
    };
  }
}
