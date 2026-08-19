import crypto from 'node:crypto';
import { numericSettingDefault } from '@/lib/config';
import type {
  Organization,
  OrganizationInvite,
  OrganizationMember,
  OrganizationRole,
  PrismaClient,
} from '../../generated/prisma';
import { type ConfigReader, DEFAULTS_ONLY_CONFIG } from '../config/reader';
import { sendOrganizationInviteEmail } from '../lib/email';
import { isValidEmail } from '../lib/email-address';
import { env } from '../lib/env';
import { childLogger } from '../lib/logger';
import { ensureMembership } from '../lib/membership-sync';
import { InvalidRoleError, type OrgRole, VALID_ROLES } from './organization.service';

const INVITE_EXPIRY_DAYS_KEY = 'invite.expiryDays';
const MAX_PENDING_INVITES_KEY = 'invite.maxPending';

/** How long an invitation link stays usable. Registry default; see config. */
export const INVITE_EXPIRY_DAYS = numericSettingDefault(INVITE_EXPIRY_DAYS_KEY);

/**
 * Cap on outstanding invitations per organization. Not a plan limit — a
 * blast-radius bound, so a compromised admin session can't turn the
 * invitation endpoint into a mail relay.
 */
export const MAX_PENDING_INVITES = numericSettingDefault(MAX_PENDING_INVITES_KEY);

const log = childLogger({ module: 'service/organization-invite' });

export class InviteEmailFailedError extends Error {
  constructor() {
    super('Could not send the invitation email');
    this.name = 'InviteEmailFailedError';
  }
}

export class InvalidInviteEmailError extends Error {
  constructor() {
    super('A valid email address is required');
    this.name = 'InvalidInviteEmailError';
  }
}

export class InviteRoleNotAllowedError extends Error {
  constructor() {
    super('Only an owner can invite another owner');
    this.name = 'InviteRoleNotAllowedError';
  }
}

export class AlreadyMemberError extends Error {
  constructor() {
    super('That person is already a member of this workspace');
    this.name = 'AlreadyMemberError';
  }
}

export class TooManyInvitesError extends Error {
  constructor() {
    super(`An organization can have at most ${MAX_PENDING_INVITES} pending invitations`);
    this.name = 'TooManyInvitesError';
  }
}

export class InviteNotFoundError extends Error {
  constructor() {
    super('This invitation is no longer valid');
    this.name = 'InviteNotFoundError';
  }
}

export class InviteEmailMismatchError extends Error {
  constructor(readonly invitedEmail: string) {
    super(`This invitation was sent to ${invitedEmail}`);
    this.name = 'InviteEmailMismatchError';
  }
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * "This invitation is still usable": not spent, not revoked, not expired.
 * Written once so adding a fourth condition later doesn't mean finding every
 * query that happened to spell out the first three. The revoke-then-issue
 * `updateMany` in `create` deliberately does NOT use this — it must also
 * catch already-expired rows, which have nothing left to revoke but would
 * otherwise accumulate.
 */
function livePendingWhere() {
  return { acceptedAt: null, expiresAt: { gt: new Date() }, revokedAt: null };
}

export interface InviteWithOrg extends OrganizationInvite {
  organization: Organization;
}

export class OrganizationInviteService {
  constructor(
    private prisma: PrismaClient,
    private config: ConfigReader = DEFAULTS_ONLY_CONFIG,
  ) {}

  /**
   * The acceptance link for a raw token. Built from the server-configured
   * `APP_URL` rather than anything request-derived, so a spoofed Host header
   * can't redirect invitations to an attacker's origin.
   */
  inviteUrl(token: string): string {
    return `${env.APP_URL}/invite/${token}`;
  }

  /**
   * Issue an invitation **and deliver it**, returning the persisted row.
   *
   * The send lives here rather than in the resolver because "an invitation
   * exists only if its mail went out" is one transaction, not two steps a
   * caller has to remember to sequence: the row stores only the token's
   * hash, so an undelivered invitation is permanently unusable while still
   * appearing healthy in the pending list. If the send fails the row is
   * revoked and `InviteEmailFailedError` is raised. Mirrors
   * `AuthService.sendMagicLink`, which likewise mints and sends together.
   *
   * The raw token never leaves this method.
   *
   * `actorRole` gates owner-granting: an admin may invite admins, members,
   * and guests, but promoting someone to owner is an owner's call. Without
   * this an admin could invite a throwaway address as owner and escalate.
   */
  async create(params: {
    orgId: string;
    email: string;
    role: OrganizationRole;
    invitedById: string;
    actorRole: string;
  }): Promise<OrganizationInvite> {
    const email = params.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      throw new InvalidInviteEmailError();
    }
    if (!VALID_ROLES.includes(params.role as OrgRole)) {
      throw new InvalidRoleError();
    }
    if (params.role === 'owner' && params.actorRole !== 'owner') {
      throw new InviteRoleNotAllowedError();
    }

    // Independent reads — the "already a member" check and the pending-count
    // cap don't inform each other.
    const [existing, pending, org, inviter] = await Promise.all([
      // Someone already in the workspace doesn't need an invitation, and
      // issuing one would imply their role is about to change when accepting
      // it wouldn't change anything.
      this.prisma.organizationMember.findFirst({
        where: { organizationId: params.orgId, user: { email } },
      }),
      this.prisma.organizationInvite.count({
        where: { ...livePendingWhere(), organizationId: params.orgId },
      }),
      this.prisma.organization.findUnique({
        select: { name: true },
        where: { id: params.orgId },
      }),
      this.prisma.user.findUnique({
        select: { displayName: true, locale: true, name: true },
        where: { id: params.invitedById },
      }),
    ]);
    if (existing) {
      throw new AlreadyMemberError();
    }
    const [maxPending, expiryDays] = await Promise.all([
      this.config.getInt(MAX_PENDING_INVITES_KEY, { orgId: params.orgId }),
      this.config.getInt(INVITE_EXPIRY_DAYS_KEY, { orgId: params.orgId }),
    ]);
    if (pending >= maxPending) {
      throw new TooManyInvitesError();
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    // Revoke-then-issue in one transaction so re-inviting someone can never
    // leave two live invitations for the same address — the older link stops
    // working the moment the new mail goes out.
    const invite = await this.prisma.$transaction(async tx => {
      await tx.organizationInvite.updateMany({
        data: { revokedAt: new Date() },
        where: {
          acceptedAt: null,
          email,
          organizationId: params.orgId,
          revokedAt: null,
        },
      });
      return tx.organizationInvite.create({
        data: {
          email,
          expiresAt,
          invitedById: params.invitedById,
          organizationId: params.orgId,
          role: params.role,
          tokenHash: hashInviteToken(token),
        },
      });
    });

    try {
      await sendOrganizationInviteEmail({
        inviterName: inviter?.displayName ?? inviter?.name ?? null,
        inviteUrl: this.inviteUrl(token),
        locale: inviter?.locale,
        organizationName: org?.name ?? '',
        to: email,
      });
    } catch (err) {
      log.error({ err, inviteId: invite.id }, 'invitation email failed to send');
      // Compensate: an invitation whose link was never delivered would sit in
      // the pending list looking healthy and could never be accepted.
      await this.revoke(params.orgId, invite.id);
      throw new InviteEmailFailedError();
    }

    return invite;
  }

  /** Outstanding invitations for the workspace settings list. */
  async listPending(orgId: string): Promise<OrganizationInvite[]> {
    return this.prisma.organizationInvite.findMany({
      orderBy: { createdAt: 'desc' },
      where: { ...livePendingWhere(), organizationId: orgId },
    });
  }

  /**
   * Revoke by id, scoped to `orgId` so one workspace's admin can't cancel
   * another's invitation by guessing an id. Returns false when nothing
   * matched (already accepted, already revoked, or not this org's).
   */
  async revoke(orgId: string, inviteId: string): Promise<boolean> {
    const result = await this.prisma.organizationInvite.updateMany({
      data: { revokedAt: new Date() },
      where: {
        acceptedAt: null,
        id: inviteId,
        organizationId: orgId,
        revokedAt: null,
      },
    });
    return result.count > 0;
  }

  /**
   * Resolve a raw token to a live invitation for the "you've been invited to
   * X" preview. Returns null for anything spent, revoked, or expired — the
   * page renders the same "no longer valid" state for all three rather than
   * reporting which, since the reader is not necessarily the invitee.
   */
  async findLiveByToken(token: string): Promise<InviteWithOrg | null> {
    const invite = await this.prisma.organizationInvite.findFirst({
      // The whole organization row, not a projection: `accept` returns it
      // straight into GraphQL's `Organization!`, which needs every field.
      // It is one join either way.
      include: { organization: true },
      where: {
        ...livePendingWhere(),
        organization: { archivedAt: null, suspendedAt: null },
        tokenHash: hashInviteToken(token),
      },
    });
    return invite;
  }

  /**
   * Claim an invitation for `userId`.
   *
   * Two properties matter here:
   *
   * 1. **The claim is atomic.** The `updateMany` is scoped to
   *    `acceptedAt: null` so two concurrent acceptances race in the database
   *    and exactly one wins — the same guard `AuthService.verifyMagicLink`
   *    uses on magic-link codes. A find-then-update would let both callers
   *    through.
   * 2. **The email must match.** Otherwise an invitation link is a bearer
   *    token: anyone who receives a forwarded copy joins the workspace. The
   *    comparison is case-insensitive because mailbox capitalization is not
   *    meaningful to users even though it is to the RFC.
   *
   * Already being a member is treated as success. The invitation is spent
   * either way, and reporting failure for "you're already in" would be a
   * confusing dead end for someone who clicked the link twice.
   */
  async accept(
    token: string,
    userId: string,
  ): Promise<{
    created: boolean;
    membership: OrganizationMember;
    organization: Organization;
    role: string;
  }> {
    // Both reads are needed before anything is decided, and neither informs
    // the other.
    const [invite, user] = await Promise.all([
      this.findLiveByToken(token),
      this.prisma.user.findUnique({ select: { email: true }, where: { id: userId } }),
    ]);
    if (!invite || !user) {
      throw new InviteNotFoundError();
    }
    if (invite.email !== user.email.trim().toLowerCase()) {
      throw new InviteEmailMismatchError(invite.email);
    }

    const now = new Date();
    const claimed = await this.prisma.organizationInvite.updateMany({
      data: { acceptedAt: now, acceptedById: userId },
      where: {
        acceptedAt: null,
        expiresAt: { gt: now },
        id: invite.id,
        revokedAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new InviteNotFoundError();
    }

    // The claim above is the single-use guard; this is idempotent on purpose,
    // because a membership may already exist (invited someone who joined by
    // another route in the meantime) and an invitation must not silently
    // demote an established member. `created` is what tells the caller
    // whether there is a join to broadcast.
    const { created, membership } = await ensureMembership(
      this.prisma,
      invite.organizationId,
      userId,
      invite.role,
    );

    // The organization comes from the row `findLiveByToken` already joined —
    // returning only its id would force every caller into a second read.
    return { created, membership, organization: invite.organization, role: invite.role };
  }
}
