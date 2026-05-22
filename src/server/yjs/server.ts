/**
 * Hocuspocus YJS collaborative editing server.
 *
 * Handles per-document WebSocket rooms for real-time multi-cursor co-editing.
 * Authentication reuses the existing ws_ticket JWT (PATTERNS.md §18 + §51).
 * Persistence reads/writes Issue.descriptionState (Bytes) via Prisma.
 *
 * Start with:  yarn yjs:server
 */

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { verifyWsTicket } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';

const log = childLogger({ module: 'yjs' });

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
    if (parsed.type === 'issue') {
      const issue = await prisma.issue.findFirst({
        select: { id: true },
        where: { archivedAt: null, id: parsed.id, organizationId: claims.orgId },
      });
      if (!issue) {
        log.warn({ documentName, orgId: claims.orgId }, 'YJS connection rejected: issue not found');
        throw new Error('Not found');
      }
    }
    // 'document' type: reserved for future Document.contentState migration.
    // Reject for now to prevent silent no-ops on unsupported entity types.
    else {
      throw new Error('Document collaborative editing not yet available');
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
    if (!parsed || parsed.type !== 'issue') {
      return;
    }

    const issue = await prisma.issue.findFirst({
      select: { descriptionState: true },
      where: { archivedAt: null, id: parsed.id, organizationId: (context as HookContext).orgId },
    });

    const stateBytes = issue?.descriptionState;
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
  async onStoreDocument({ document, documentName }) {
    const parsed = parseDocName(documentName);
    if (!parsed || parsed.type !== 'issue') {
      return;
    }

    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    try {
      await prisma.issue.update({
        data: { descriptionState: state },
        where: { id: parsed.id },
      });
      log.debug({ bytes: state.length, documentName }, 'Persisted YJS state to DB');
    } catch (err) {
      log.error({ documentName, err }, 'Failed to persist YJS state');
    }
  },
  // Keep quiet=true; structured pino logs below surface what matters.
  quiet: true,
});
