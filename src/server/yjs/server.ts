/**
 * Hocuspocus YJS collaborative editing server.
 *
 * Handles per-document WebSocket rooms for real-time multi-cursor co-editing.
 * Authentication reuses the existing ws_ticket JWT (PATTERNS.md §18 + §51).
 * Persistence reads/writes Issue.descriptionState (Bytes) via Prisma.
 *
 * Start with:  yarn yjs:server
 *
 * Re-validation: `onAuthenticate` only proves access at connect time — a
 * room can stay open indefinitely afterward. Two layers close that gap:
 *  (a) `onStoreDocument` (already runs on every debounced write) re-checks
 *      the writer's access via `revalidateAccess` and skips the persist +
 *      closes that connection if it's been revoked since connect.
 *  (b) a periodic sweep (`sweepRevokedYjsConnections`, every
 *      `REAUTH_SWEEP_INTERVAL_MS`) walks every open document room via
 *      Hocuspocus's own `documents` map and `Document.getConnections()` and
 *      closes any connection whose access no longer checks out — this
 *      covers a connected-but-idle peer who isn't triggering writes. Every
 *      connection in a room shares the same document, so the sweep uses the
 *      batched `revalidateRoomAccess` (org + issue/document row fetched once
 *      per room, not once per connection) rather than calling
 *      `revalidateAccess` in a per-connection loop.
 */

import { type Connection, Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { verifyWsTicket } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { checkSessionValidity, getTeamRole } from '@/server/middleware/auth';
import type { PrismaClient } from '../../generated/prisma';

const log = childLogger({ module: 'yjs' });

// Re-validate every open room every 60s — matches the WS server's own
// re-auth sweep interval (src/server/ws/index.ts) so both channels close a
// revoked session on a comparable timescale.
const REAUTH_SWEEP_INTERVAL_MS = 60_000;

// Context stamped by onAuthenticate and forwarded to subsequent hooks.
type HookContext = { orgId: string; userId: string };

// Document naming: "issue:<uuid>" or "document:<uuid>" (document type reserved
// for when Document.contentState is added in a follow-up migration).
const ISSUE_RE = /^issue:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DOC_RE = /^document:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function parseDocName(name: string): { type: 'issue' | 'document'; id: string } | null {
  let m = ISSUE_RE.exec(name);
  if (m) {
    return { id: m[1], type: 'issue' };
  }
  m = DOC_RE.exec(name);
  if (m) {
    return { id: m[1], type: 'document' };
  }
  return null;
}

export interface RevalidateResult {
  /** Present only when `valid` is `false` — for logging, not user-facing. */
  reason?: string;
  valid: boolean;
}

type EntityAccessPrisma = Pick<PrismaClient, 'teamMemberRole' | 'teamMembership'>;
type IssueEntityRow = { assigneeId: string | null; creatorId: string | null; teamId: string };
type DocEntityRow = { teamId: string | null };

/**
 * The part of the accessibility check that depends on which user is asking:
 * team membership + guest visibility for an already-fetched issue/document
 * row. Split out from `revalidateAccess` so the batched, per-room
 * `revalidateRoomAccess` below can fetch the shared issue/org rows ONCE per
 * room and only re-run this (genuinely per-user) part for each connection.
 */
async function checkEntityAccessForUser(
  prismaClient: EntityAccessPrisma,
  parsed: { type: 'document' | 'issue' },
  entity: DocEntityRow | IssueEntityRow | null,
  orgId: string,
  userId: string,
): Promise<RevalidateResult> {
  if (parsed.type === 'issue') {
    const issue = entity as IssueEntityRow | null;
    if (!issue) {
      return { reason: 'issue not found or archived', valid: false };
    }
    const role = await getTeamRole(prismaClient as PrismaClient, issue.teamId, userId, orgId);
    if (!role) {
      return { reason: 'no longer a member of this team', valid: false };
    }
    if (role === 'guest' && issue.creatorId !== userId && issue.assigneeId !== userId) {
      return { reason: 'guest no longer has access to this issue', valid: false };
    }
    return { valid: true };
  }

  const doc = entity as DocEntityRow | null;
  if (!doc) {
    return { reason: 'document not found or archived', valid: false };
  }
  if (doc.teamId) {
    const role = await getTeamRole(prismaClient as PrismaClient, doc.teamId, userId, orgId);
    if (!role) {
      return { reason: 'no longer a member of this team', valid: false };
    }
  }
  return { valid: true };
}

/**
 * Re-run the same accessibility checks `onAuthenticate` performs at connect
 * time — user still active, org not suspended/archived, and (for issues)
 * still a member of the issue's team with guest visibility honored — some
 * time AFTER a connection was first authenticated. Used by the
 * `onStoreDocument` gate (a single writer's connection, so there's no room
 * to batch across). The periodic sweep below uses the batched
 * `revalidateRoomAccess` instead — see its doc comment for why.
 *
 * Takes `prisma` as a parameter (rather than reaching for the module-level
 * singleton) so it's directly unit-testable with a mocked client — no live
 * socket, Hocuspocus runtime, or DB required.
 */
export async function revalidateAccess(
  prismaClient: Pick<
    PrismaClient,
    'document' | 'issue' | 'organization' | 'teamMemberRole' | 'teamMembership' | 'user'
  >,
  parsed: { id: string; type: 'document' | 'issue' },
  orgId: string,
  userId: string,
): Promise<RevalidateResult> {
  const user = await prismaClient.user.findUnique({
    select: { active: true },
    where: { id: userId },
  });
  // Checked inline (rather than deferring to checkSessionValidity below)
  // so a deactivated user short-circuits before the org query — matches
  // the original behavior and this file's own test coverage, which asserts
  // `organization.findUnique` is never called in that case.
  if (!user?.active) {
    return { reason: 'user deactivated', valid: false };
  }

  const org = await prismaClient.organization.findUnique({
    select: { archivedAt: true, suspendedAt: true },
    where: { id: orgId },
  });
  // Shared "user active AND org not suspended/archived" predicate — see its
  // doc comment in middleware/auth.ts for why this used to be hand-rolled
  // three times and had drifted between callers.
  const sessionValidity = checkSessionValidity(user, org);
  if (!sessionValidity.valid) {
    return sessionValidity;
  }

  if (parsed.type === 'issue') {
    const issue = await prismaClient.issue.findFirst({
      select: { assigneeId: true, creatorId: true, teamId: true },
      where: { archivedAt: null, id: parsed.id, organizationId: orgId },
    });
    return checkEntityAccessForUser(prismaClient, parsed, issue, orgId, userId);
  }

  const doc = await prismaClient.document.findFirst({
    select: { teamId: true },
    where: { archivedAt: null, id: parsed.id, organizationId: orgId },
  });
  return checkEntityAccessForUser(prismaClient, parsed, doc, orgId, userId);
}

/**
 * Batched version of `revalidateAccess` for the periodic sweep
 * (`sweepRevokedYjsConnections`), which re-checks every connection in every
 * open room. Every connection in a *room* shares the same document — so the
 * org row and the issue/document row are fetched exactly ONCE per room here,
 * instead of once per connection as a naive per-connection loop over
 * `revalidateAccess` would do. The user-active check is batched into a
 * single `findMany` across the room's distinct user ids.
 *
 * Residual: the team-membership/guest check (`checkEntityAccessForUser` →
 * `getTeamRole`) still runs per user (2 queries each — team membership +
 * team role) — it's the one part of the check that's genuinely
 * user-specific, not shared across the room. Batching it further would mean
 * teaching `getTeamRole` to accept a set of user ids, which is more
 * invasive than this pass's scope; the win here is the org + issue/document
 * fetch, which no longer scales with connection count.
 *
 * Returns a `Map<userId, RevalidateResult>` — one entry per distinct user id
 * passed in — so the caller can look up each connection's result by its
 * owning user without re-deriving it.
 */
export async function revalidateRoomAccess(
  prismaClient: Pick<
    PrismaClient,
    'document' | 'issue' | 'organization' | 'teamMemberRole' | 'teamMembership' | 'user'
  >,
  parsed: { id: string; type: 'document' | 'issue' },
  orgId: string,
  userIds: string[],
): Promise<Map<string, RevalidateResult>> {
  const results = new Map<string, RevalidateResult>();
  const distinctIds = [...new Set(userIds)];
  if (distinctIds.length === 0) {
    return results;
  }

  const [users, org, entity] = await Promise.all([
    prismaClient.user.findMany({
      select: { active: true, id: true },
      where: { id: { in: distinctIds } },
    }),
    prismaClient.organization.findUnique({
      select: { archivedAt: true, suspendedAt: true },
      where: { id: orgId },
    }),
    parsed.type === 'issue'
      ? prismaClient.issue.findFirst({
          select: { assigneeId: true, creatorId: true, teamId: true },
          where: { archivedAt: null, id: parsed.id, organizationId: orgId },
        })
      : prismaClient.document.findFirst({
          select: { teamId: true },
          where: { archivedAt: null, id: parsed.id, organizationId: orgId },
        }),
  ]);
  const userById = new Map(users.map(u => [u.id, u]));

  for (const userId of distinctIds) {
    const sessionValidity = checkSessionValidity(userById.get(userId), org);
    if (!sessionValidity.valid) {
      results.set(userId, sessionValidity);
      continue;
    }
    results.set(
      userId,
      await checkEntityAccessForUser(prismaClient, parsed, entity, orgId, userId),
    );
  }

  return results;
}

export const server = new Server<HookContext>({
  // Debounce DB writes: flush at most once per 2s of inactivity, hard cap 20s.
  debounce: 2_000,
  maxDebounce: 20_000,
  name: 'bilinear-yjs',

  // ─── Auth ─────────────────────────────────────────────────────────────────
  // Called before any document operations. Token is the ws_ticket sent by
  // HocuspocusProvider on the client side. Throwing rejects the connection.
  async onAuthenticate({ token, documentName, context }) {
    if (!token) {
      log.warn({ documentName }, 'YJS connection rejected: no token');
      throw new Error('Missing authentication token');
    }

    let claims: { orgId: string; userId: string };
    try {
      claims = await verifyWsTicket(token);
    } catch {
      log.warn({ documentName }, 'YJS connection rejected: invalid token');
      throw new Error('Invalid or expired token');
    }

    const parsed = parseDocName(documentName);
    if (!parsed) {
      log.warn({ documentName }, 'YJS connection rejected: invalid document name');
      throw new Error(`Invalid document name: ${documentName}`);
    }

    // Tenant guard — verify the entity belongs to the authenticated org.
    // Archived entities are treated as inaccessible to prevent collab sessions
    // on soft-deleted content.
    //
    // Beyond the org check, also enforce team-membership + guest visibility:
    // without this, any org member could open a collab room for ANY issue by
    // UUID and read/edit its body, including issues on teams they aren't in,
    // or a guest issue they don't own — bypassing the same rule the
    // top-level `issues` query and `IssueService.buildWhere`'s
    // `guestUserId` clause enforce elsewhere.
    if (parsed.type === 'issue') {
      const issue = await prisma.issue.findFirst({
        select: { assigneeId: true, creatorId: true, id: true, teamId: true },
        where: { archivedAt: null, id: parsed.id, organizationId: claims.orgId },
      });
      if (!issue) {
        log.warn({ documentName, orgId: claims.orgId }, 'YJS connection rejected: issue not found');
        throw new Error('Not found');
      }
      const role = await getTeamRole(prisma, issue.teamId, claims.userId, claims.orgId);
      if (!role) {
        log.warn(
          { documentName, orgId: claims.orgId, userId: claims.userId },
          "YJS connection rejected: not a member of this issue's team",
        );
        throw new Error('Not a member of this team');
      }
      if (
        role === 'guest' &&
        issue.creatorId !== claims.userId &&
        issue.assigneeId !== claims.userId
      ) {
        log.warn(
          { documentName, orgId: claims.orgId, userId: claims.userId },
          'YJS connection rejected: guest cannot access this issue',
        );
        throw new Error('Guests can only access issues they created or are assigned to');
      }
    } else {
      const doc = await prisma.document.findFirst({
        select: { id: true, teamId: true },
        where: { archivedAt: null, id: parsed.id, organizationId: claims.orgId },
      });
      if (!doc) {
        log.warn(
          { documentName, orgId: claims.orgId },
          'YJS connection rejected: document not found',
        );
        throw new Error('Not found');
      }
      // Documents are only team-scoped when teamId is set (workspace-level
      // docs have a null teamId and are visible to the whole org, matching
      // the GraphQL `documents`/`document` resolvers, which apply no
      // team-membership check today).
      if (doc.teamId) {
        const role = await getTeamRole(prisma, doc.teamId, claims.userId, claims.orgId);
        if (!role) {
          log.warn(
            { documentName, orgId: claims.orgId, userId: claims.userId },
            "YJS connection rejected: not a member of this document's team",
          );
          throw new Error('Not a member of this team');
        }
      }
    }

    // Stamp context so downstream hooks can read orgId/userId without
    // re-verifying the token.
    context.orgId = claims.orgId;
    context.userId = claims.userId;

    log.info({ documentName, userId: claims.userId }, 'YJS client authenticated');
  },

  async onDisconnect({ documentName, context }) {
    log.info({ documentName, userId: (context as HookContext)?.userId }, 'YJS client disconnected');
  },

  // ─── Load ─────────────────────────────────────────────────────────────────
  // Hydrate the in-memory YJS document from the persisted state bytes.
  // Called once per document name when the first client connects.
  async onLoadDocument({ document, documentName, context }) {
    const parsed = parseDocName(documentName);
    if (!parsed) {
      return;
    }

    let stateBytes: Buffer | null | undefined;

    if (parsed.type === 'issue') {
      const issue = await prisma.issue.findFirst({
        select: { descriptionState: true },
        where: { archivedAt: null, id: parsed.id, organizationId: (context as HookContext).orgId },
      });
      stateBytes = issue?.descriptionState as Buffer | null | undefined;
    } else {
      const doc = await prisma.document.findFirst({
        select: { contentState: true },
        where: { archivedAt: null, id: parsed.id, organizationId: (context as HookContext).orgId },
      });
      stateBytes = doc?.contentState as Buffer | null | undefined;
    }

    if (stateBytes && stateBytes.length > 0) {
      Y.applyUpdate(document, stateBytes);
      log.debug({ bytes: stateBytes.length, documentName }, 'Loaded YJS state from DB');
    } else {
      log.debug(
        { documentName, userId: context.userId },
        'No stored YJS state — client will seed on first connect',
      );
    }
  },

  // ─── Store ────────────────────────────────────────────────────────────────
  // Persist the YJS document state to the DB. Debounced by the config above
  // so we don't hammer Postgres on every keystroke.
  async onStoreDocument({ document, documentName, lastContext }) {
    const parsed = parseDocName(documentName);
    if (!parsed) {
      return;
    }

    // Re-validate the writer whose transaction triggered this (debounced)
    // flush — `lastContext` is the HookContext stamped by onAuthenticate for
    // whichever connection made the most recent change. Tenant isolation is
    // enforced at connect time, but a session can be revoked (deactivated,
    // org suspended, removed from the team) any time after that while the
    // room stays open — this is the layer that catches it on every write.
    const { orgId, userId } = (lastContext ?? {}) as Partial<HookContext>;
    if (orgId && userId) {
      const result = await revalidateAccess(prisma, parsed, orgId, userId);
      if (!result.valid) {
        log.warn(
          { documentName, orgId, reason: result.reason, userId },
          'YJS store skipped: writer access revoked since connect — closing their connection',
        );
        // Don't persist an edit from a session that should no longer have
        // access, and close that specific connection so it stops being able
        // to make further edits. Other still-valid connections on the same
        // room are left alone.
        for (const connection of document.getConnections()) {
          const ctx = connection.context as Partial<HookContext> | undefined;
          if (ctx?.orgId === orgId && ctx?.userId === userId) {
            connection.close();
          }
        }
        return;
      }
    }

    // Tenant isolation is enforced at connection time in onAuthenticate. The
    // connection is bound to a single document room so the id alone is the
    // correct unique selector for Prisma's update (which requires @id/@unique).
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    try {
      if (parsed.type === 'issue') {
        await prisma.issue.update({
          data: { descriptionState: state },
          where: { id: parsed.id },
        });
      } else {
        await prisma.document.update({
          data: { contentState: state },
          where: { id: parsed.id },
        });
      }
      log.debug({ bytes: state.length, documentName }, 'Persisted YJS state to DB');
    } catch (err) {
      log.error({ documentName, err }, 'Failed to persist YJS state');
    }
  },
  // Keep quiet=true; structured pino logs below surface what matters.
  quiet: true,
});

// ─── Periodic re-auth sweep ─────────────────────────────────────────────────
// `onStoreDocument` above only re-validates on a write — a connected peer who
// isn't editing (just reading, or idle) could otherwise go unchecked between
// writes. Hocuspocus exposes every open room (`server.hocuspocus.documents`)
// and each room's live connections (`Document.getConnections()`), so we can
// walk all of them on a timer and close anything whose access no longer
// checks out, independent of write activity.
let yjsSweepInFlight = false;

export async function sweepRevokedYjsConnections(): Promise<void> {
  // Re-entrancy guard: a sweep does one sequential DB round-trip per
  // connection per room, so under heavy collab load a pass can exceed the
  // interval. Without this, the next tick would start a second overlapping
  // sweep, compounding DB load in a self-reinforcing loop. Skip if one is
  // already running — the next tick will cover anything missed.
  if (yjsSweepInFlight) {
    return;
  }
  yjsSweepInFlight = true;
  try {
    await runYjsSweep();
  } finally {
    yjsSweepInFlight = false;
  }
}

async function runYjsSweep(): Promise<void> {
  for (const [documentName, document] of server.hocuspocus.documents) {
    const parsed = parseDocName(documentName);
    if (!parsed) {
      // Shouldn't happen — onAuthenticate already rejects any documentName
      // that doesn't parse, so no room should exist under a bad name.
      continue;
    }

    // Group this room's connections by orgId, then by userId, instead of
    // re-validating each connection one at a time — every connection in a
    // room shares the same document (and, in practice, the same org, since
    // onAuthenticate ties a document to exactly one org at connect time), so
    // `revalidateRoomAccess` can fetch the org + issue/document row ONCE for
    // the whole room. Grouping by orgId is defensive (costs nothing, and
    // keeps this correct even if that single-org invariant were ever
    // violated); grouping by userId handles a user with more than one open
    // connection to the same room (e.g. two tabs) sharing one result.
    const byOrg = new Map<string, Map<string, Connection[]>>();
    for (const connection of document.getConnections()) {
      const ctx = connection.context as Partial<HookContext> | undefined;
      if (!ctx?.orgId || !ctx.userId) {
        continue;
      }
      let byUser = byOrg.get(ctx.orgId);
      if (!byUser) {
        byUser = new Map();
        byOrg.set(ctx.orgId, byUser);
      }
      const connections = byUser.get(ctx.userId) ?? [];
      connections.push(connection);
      byUser.set(ctx.userId, connections);
    }

    for (const [orgId, byUser] of byOrg) {
      try {
        const results = await revalidateRoomAccess(prisma, parsed, orgId, [...byUser.keys()]);
        for (const [userId, connections] of byUser) {
          const result = results.get(userId);
          if (!result?.valid) {
            for (const connection of connections) {
              log.info(
                { documentName, orgId, reason: result?.reason, userId },
                'YJS re-auth sweep: closing revoked connection',
              );
              connection.close();
            }
          }
        }
      } catch (err) {
        log.error({ documentName, err, orgId }, 'YJS re-auth sweep failed for room');
      }
    }
  }
}

const reauthSweepTimer = setInterval(() => {
  sweepRevokedYjsConnections().catch((err: unknown) => {
    log.error({ err }, 'YJS re-auth sweep failed');
  });
}, REAUTH_SWEEP_INTERVAL_MS);
// Don't let this timer alone keep the process alive — the Hocuspocus HTTP
// server's own listening socket is what should do that (matches the
// `unref()`-free-but-explicit `shutdown()` teardown in yjs/index.ts, which
// exits the process directly rather than clearing individual timers).
reauthSweepTimer.unref();
