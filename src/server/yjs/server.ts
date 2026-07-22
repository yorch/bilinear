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
 *      covers a connected-but-idle peer who isn't triggering writes.
 */

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { verifyWsTicket } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { getTeamRole } from '@/server/middleware/auth';
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

/**
 * Re-run the same accessibility checks `onAuthenticate` performs at connect
 * time — user still active, org not suspended/archived, and (for issues)
 * still a member of the issue's team with guest visibility honored — some
 * time AFTER a connection was first authenticated. Used by both the
 * `onStoreDocument` gate and the periodic sweep below.
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
  if (!user?.active) {
    return { reason: 'user deactivated', valid: false };
  }

  const org = await prismaClient.organization.findUnique({
    select: { archivedAt: true, suspendedAt: true },
    where: { id: orgId },
  });
  if (!org || org.suspendedAt || org.archivedAt) {
    return { reason: 'org suspended or archived', valid: false };
  }

  if (parsed.type === 'issue') {
    const issue = await prismaClient.issue.findFirst({
      select: { assigneeId: true, creatorId: true, teamId: true },
      where: { archivedAt: null, id: parsed.id, organizationId: orgId },
    });
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
  } else {
    const doc = await prismaClient.document.findFirst({
      select: { teamId: true },
      where: { archivedAt: null, id: parsed.id, organizationId: orgId },
    });
    if (!doc) {
      return { reason: 'document not found or archived', valid: false };
    }
    if (doc.teamId) {
      const role = await getTeamRole(prismaClient as PrismaClient, doc.teamId, userId, orgId);
      if (!role) {
        return { reason: 'no longer a member of this team', valid: false };
      }
    }
  }

  return { valid: true };
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
export async function sweepRevokedYjsConnections(): Promise<void> {
  for (const [documentName, document] of server.hocuspocus.documents) {
    const parsed = parseDocName(documentName);
    if (!parsed) {
      // Shouldn't happen — onAuthenticate already rejects any documentName
      // that doesn't parse, so no room should exist under a bad name.
      continue;
    }
    for (const connection of document.getConnections()) {
      const ctx = connection.context as Partial<HookContext> | undefined;
      if (!ctx?.orgId || !ctx.userId) {
        continue;
      }
      try {
        const result = await revalidateAccess(prisma, parsed, ctx.orgId, ctx.userId);
        if (!result.valid) {
          log.info(
            { documentName, orgId: ctx.orgId, reason: result.reason, userId: ctx.userId },
            'YJS re-auth sweep: closing revoked connection',
          );
          connection.close();
        }
      } catch (err) {
        log.error(
          { documentName, err, orgId: ctx.orgId, userId: ctx.userId },
          'YJS re-auth sweep failed for connection',
        );
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
