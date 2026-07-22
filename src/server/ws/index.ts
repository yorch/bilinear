/**
 * Standalone WebSocket server for real-time sync broadcasting.
 *
 * Run with:  yarn ws:server
 *
 * It:
 *  1. Authenticates clients via a short-lived `ws_ticket` JWT passed as a
 *     `token` query param. Tickets are issued by `/api/auth/ws-ticket`.
 *  2. Subscribes to Redis PubSub channel `sync:<orgId>`
 *  3. Broadcasts incoming SyncActions to all connected org clients
 *  4. Sends periodic pings and handles pong / reconnection
 *  5. Periodically re-validates each connection's auth (see
 *     `sweepRevokedConnections`) so a socket authenticated at connect time
 *     doesn't keep receiving the org's sync stream forever after the
 *     underlying user/org is deactivated/suspended — the 60s `ws_ticket`
 *     only proves auth was valid AT CONNECT TIME, and unlike an HTTP
 *     request, a long-lived socket never gives `extractAuthContext` another
 *     chance to re-check.
 */

import { createServer } from 'node:http';
import Redis from 'ioredis';
import { type WebSocket, WebSocketServer } from 'ws';
import { WS_PING_INTERVAL_MS, WS_PONG_TIMEOUT_MS } from '@/lib/sync-config';
import { env } from '@/server/lib/env';
import { verifyWsTicket } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { CycleService } from '@/server/services/cycle.service';
import { SyncService } from '@/server/services/sync.service';
import { WebhookService } from '@/server/services/webhook.service';
import { ConnectionManager } from './connection-manager';

const log = childLogger({ module: 'ws' });

const PORT = env.WS_PORT;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
// Sourced from the shared `sync-config` module so client and server can't
// silently drift — see `src/lib/sync-config.ts`.
const PING_INTERVAL_MS = WS_PING_INTERVAL_MS;
// Force-terminate clients that haven't responded to two consecutive pings,
// so half-open TCP connections don't accumulate ConnectionManager entries.
const PONG_TIMEOUT_MS = WS_PONG_TIMEOUT_MS;
// Run the webhook delivery scheduler every 30s. It picks up any pending
// deliveries whose nextAttemptAt has passed and retries them. Co-locating
// with the WS server (instead of the Next request path) keeps retries
// running between requests on serverless deployments.
const WEBHOOK_RETRY_INTERVAL_MS = 30_000;
// Check for cycles past their endsAt every 5 minutes and roll them over.
const CYCLE_ROLLOVER_INTERVAL_MS = 5 * 60_000;
// Re-validate every live connection's auth (user still active, org not
// suspended/archived) every 60s — matches the ws_ticket's own lifetime, so a
// revoked connection is caught about as fast as a fresh connect attempt
// would be rejected.
const REAUTH_SWEEP_INTERVAL_MS = 60_000;
// Close code for a connection whose auth was found revoked by the sweep.
// Distinct from 4001 (used for connect-time rejection) so the reason is
// unambiguous in logs/client handling.
const REVOKED_CLOSE_CODE = 4003;

// verifyWsTicket() reads JWT_SECRET via getSecret() and throws if unset
if (!process.env.JWT_SECRET) {
  log.fatal('JWT_SECRET is not set — cannot verify tokens');
  process.exit(1);
}

// ─── Redis ───────────────────────────────────────────────────────────────────

const redisSubscriber = new Redis(REDIS_URL, { lazyConnect: false });
const connectionManager = new ConnectionManager();

// Track which org channels we've already subscribed to
const subscribedOrgs = new Set<string>();
// Serialize subscribe/unsubscribe per orgId so a fast disconnect → connect
// cycle can't end up with the channel marked "subscribed" while the actual
// Redis SUBSCRIBE is still in flight (or vice versa).
const orgSubLocks = new Map<string, Promise<void>>();

async function withOrgSubLock(orgId: string, fn: () => Promise<void>): Promise<void> {
  const prev = orgSubLocks.get(orgId) ?? Promise.resolve();
  const next = prev.then(fn).catch((err: unknown) => {
    log.error({ err, orgId }, 'Org subscription lock error');
  });
  orgSubLocks.set(
    orgId,
    next.finally(() => {
      if (orgSubLocks.get(orgId) === next) {
        orgSubLocks.delete(orgId);
      }
    }),
  );
  await next;
}

async function ensureOrgSubscription(orgId: string) {
  await withOrgSubLock(orgId, async () => {
    if (subscribedOrgs.has(orgId)) {
      return;
    }
    await redisSubscriber.subscribe(`sync:${orgId}`);
    subscribedOrgs.add(orgId);
    log.info({ orgId }, 'Subscribed to Redis channel');
  });
}

async function maybeReleaseOrgSubscription(orgId: string) {
  await withOrgSubLock(orgId, async () => {
    // Re-check inside the lock — a new client may have connected since
    // the disconnect handler queued this release.
    if (connectionManager.clientCount(orgId) > 0) {
      return;
    }
    if (!subscribedOrgs.has(orgId)) {
      return;
    }
    subscribedOrgs.delete(orgId);
    try {
      await redisSubscriber.unsubscribe(`sync:${orgId}`);
    } catch (err) {
      log.error({ err, orgId }, 'Failed to unsubscribe from Redis channel');
      // Re-add so a future client triggers a fresh subscribe attempt
      // rather than silently dropping messages.
      subscribedOrgs.add(orgId);
    }
  });
}

redisSubscriber.on('message', (channel: string, message: string) => {
  // channel = "sync:<orgId>"
  const orgId = channel.slice('sync:'.length);
  const payload = JSON.stringify({ cmd: 'sync', sync: [JSON.parse(message)] });
  connectionManager.broadcastToOrgAll(orgId, payload);
});

redisSubscriber.on('error', (err: Error) => {
  log.error({ err }, 'Redis subscriber error');
});

// Track whether the pubsub channel has been disrupted at least once.
// ioredis emits `ready` on initial connect and again after every reconnect;
// only reconnects need a catch-up broadcast. Messages published while the
// subscriber was disconnected are gone — the safe response is to ask
// every connected client to re-run deltaSync(), which will pull anything
// the WS missed via the HTTP catch-up endpoint.
//
// `reconnecting` covers the auto-retry path; `end` covers the case where
// retryStrategy gives up and an operator (or ioredis user code) later
// reconnects manually — without setting the flag in both places, a hard
// outage followed by a successful reconnect would silently skip the
// resync hint.
let pubsubWasDisrupted = false;
redisSubscriber.on('reconnecting', () => {
  pubsubWasDisrupted = true;
});
redisSubscriber.on('end', () => {
  pubsubWasDisrupted = true;
});
redisSubscriber.on('ready', () => {
  if (!pubsubWasDisrupted) {
    return;
  }
  pubsubWasDisrupted = false;
  log.warn('Redis subscriber reconnected — broadcasting resync hint');
  const payload = JSON.stringify({ cmd: 'resync' });
  for (const orgId of subscribedOrgs) {
    connectionManager.broadcastToOrgAll(orgId, payload);
  }
});

// ─── Re-auth sweep ───────────────────────────────────────────────────────────
// Connect-time auth (the ws_ticket) only proves the user/org were valid 60s
// ago. A socket can stay open indefinitely afterward, so we periodically
// re-derive the same suspension/deactivation checks `extractAuthContext`
// applies per-request (src/server/middleware/auth.ts) and force-close any
// connection that's no longer valid.

export interface ReauthUserRow {
  active: boolean;
}

export interface ReauthOrgRow {
  archivedAt: Date | null;
  suspendedAt: Date | null;
}

/**
 * Pure predicate: given freshly re-queried user/org rows for a live
 * connection, decide whether it should be force-closed. Mirrors
 * `extractAuthContext`'s suspension checks — a deactivated user or a
 * suspended/archived org invalidates the connection. A missing row (the
 * user or org was deleted since connect) is treated the same as invalid —
 * fail closed.
 *
 * Kept as a standalone, side-effect-free function (no DB/socket access) so
 * it's unit-testable without a live connection or database.
 */
export function shouldTerminateConnection(
  user: ReauthUserRow | null | undefined,
  org: ReauthOrgRow | null | undefined,
): boolean {
  if (!user?.active) {
    return true;
  }
  if (!org || org.suspendedAt || org.archivedAt) {
    return true;
  }
  return false;
}

interface LiveConnection {
  orgId: string;
  userId: string;
  ws: WebSocket;
}

// All currently-open, authenticated connections. Populated on connect,
// removed on close (mirrors ConnectionManager's own bookkeeping, kept
// separate so the sweep doesn't need ConnectionManager to expose an
// iteration API it doesn't otherwise need).
const liveConnections = new Set<LiveConnection>();

/**
 * Re-validate every live connection in one pass. Batches the user/org
 * lookups into two `findMany` queries (keyed by the distinct ids currently
 * connected) instead of one query per connection, so the sweep's DB cost is
 * bounded by the number of distinct users/orgs, not the number of sockets.
 */
async function sweepRevokedConnections(): Promise<void> {
  if (liveConnections.size === 0) {
    return;
  }

  const userIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const conn of liveConnections) {
    userIds.add(conn.userId);
    orgIds.add(conn.orgId);
  }

  const [users, orgs] = await Promise.all([
    prisma.user.findMany({
      select: { active: true, id: true },
      where: { id: { in: [...userIds] } },
    }),
    prisma.organization.findMany({
      select: { archivedAt: true, id: true, suspendedAt: true },
      where: { id: { in: [...orgIds] } },
    }),
  ]);
  const userById = new Map(users.map(u => [u.id, u]));
  const orgById = new Map(orgs.map(o => [o.id, o]));

  for (const conn of liveConnections) {
    if (conn.ws.readyState !== 1 /* OPEN */) {
      continue;
    }
    if (shouldTerminateConnection(userById.get(conn.userId), orgById.get(conn.orgId))) {
      log.info(
        { orgId: conn.orgId, userId: conn.userId },
        'Re-auth sweep: connection revoked — closing socket',
      );
      conn.ws.close(REVOKED_CLOSE_CODE, 'Session revoked');
    }
  }
}

// ─── HTTP + WS server ────────────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200);
  res.end('WebSocket server');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', async (ws: WebSocket, req) => {
  // Extract ws_ticket from query string: ws://host:3001/?token=<ticket>
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  let orgId: string;
  let userId: string;

  try {
    ({ orgId, userId } = await verifyWsTicket(token));
    if (!orgId || !userId) {
      throw new Error('Invalid token payload');
    }
  } catch {
    ws.close(4001, 'Invalid token');
    return;
  }

  // Register client
  const clientInfo = connectionManager.add(orgId, userId, ws);
  const liveConn: LiveConnection = { orgId, userId, ws };
  liveConnections.add(liveConn);
  await ensureOrgSubscription(orgId);

  log.info({ orgId, total: connectionManager.clientCount(), userId }, 'Client connected');

  // Send initial connection ack
  ws.send(JSON.stringify({ cmd: 'connected', orgId }));

  // Heartbeat: server pings every PING_INTERVAL_MS; if no pong within
  // PONG_TIMEOUT_MS we drop the socket so half-open connections don't
  // accumulate ConnectionManager entries.
  let lastPongAt = Date.now();
  const pingTimer = setInterval(() => {
    if (ws.readyState !== 1 /* OPEN */) {
      return;
    }
    if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
      log.info({ orgId, userId }, 'Pong timeout — terminating socket');
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify({ cmd: 'ping' }));
  }, PING_INTERVAL_MS);

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as { cmd: string };
      if (msg.cmd === 'pong') {
        lastPongAt = Date.now();
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    liveConnections.delete(liveConn);
    const orgEmpty = connectionManager.remove(clientInfo);
    log.info({ orgId, total: connectionManager.clientCount(), userId }, 'Client disconnected');
    if (orgEmpty) {
      // Serialize through the per-org lock so a racing new connection's
      // ensureOrgSubscription() runs after this release completes (or is
      // skipped because the new client repopulated the count).
      void maybeReleaseOrgSubscription(orgId);
    }
  });

  ws.on('error', (err: Error) => {
    log.error({ err, orgId }, 'Client error');
  });
});

httpServer.listen(PORT, () => {
  log.info({ port: PORT }, 'WebSocket server listening');
});

// ─── Re-auth sweep scheduler ────────────────────────────────────────────────
const reauthTimer = setInterval(() => {
  sweepRevokedConnections().catch((err: unknown) => {
    log.error({ err }, 'Re-auth sweep failed');
  });
}, REAUTH_SWEEP_INTERVAL_MS);

// ─── Webhook retry scheduler ────────────────────────────────────────────────
// Periodically drain any due `pending` deliveries. The first attempt for
// each event runs inline in the request path; this loop only services
// retries from earlier failures.
const webhookService = new WebhookService(prisma);
const webhookTimer = setInterval(() => {
  webhookService.processDuePending().catch((err: Error) => {
    log.error({ err }, 'Webhook retry sweep failed');
  });
}, WEBHOOK_RETRY_INTERVAL_MS);

// ─── Cycle auto-rollover scheduler ──────────────────────────────────────────
// Find cycles whose endsAt has passed but haven't been marked completed and
// roll them over automatically — same logic as the manual cycleRollover
// mutation, but triggered by time rather than user action.
const redisPublisher = new Redis(REDIS_URL, { lazyConnect: false });
const syncService = new SyncService(prisma, redisPublisher);
const cycleService = new CycleService(prisma);
const cycleRolloverTimer = setInterval(() => {
  cycleService
    .processDueRollovers()
    .then(async results => {
      for (const { cycleId, orgId, movedIssueIds } of results) {
        log.info({ cycleId, movedCount: movedIssueIds.length }, 'Auto-rolled over cycle');
        try {
          // Fetch the full cycle record so the SyncAction data replaces the
          // client's cached entity correctly (not just 2 fields).
          const cycle = await prisma.cycle.findUnique({ where: { id: cycleId } });
          if (cycle) {
            await syncService.createSyncAction(orgId, 'U', 'Cycle', cycleId, cycle);
          }
          if (movedIssueIds.length > 0) {
            const movedIssues = await prisma.issue.findMany({
              where: { id: { in: movedIssueIds } },
            });
            for (const issue of movedIssues) {
              await syncService.createSyncAction(orgId, 'U', 'Issue', issue.id, issue);
            }
          }
        } catch (err) {
          log.error({ cycleId, err, orgId }, 'Failed to emit SyncActions for rolled-over cycle');
        }
      }
    })
    .catch((err: Error) => {
      log.error({ err }, 'Cycle auto-rollover sweep failed');
    });
}, CYCLE_ROLLOVER_INTERVAL_MS);

// Graceful shutdown — handle both SIGTERM (process manager) and SIGINT (Ctrl-C in dev)
function shutdown() {
  clearInterval(webhookTimer);
  clearInterval(cycleRolloverTimer);
  clearInterval(reauthTimer);
  wss.close();
  redisSubscriber.disconnect();
  redisPublisher.disconnect();
  httpServer.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
