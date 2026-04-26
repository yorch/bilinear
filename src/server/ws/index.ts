/**
 * Standalone WebSocket server for real-time sync broadcasting.
 *
 * Run with:  yarn ws:server
 *
 * It:
 *  1. Authenticates clients via JWT passed as a `token` query param
 *  2. Subscribes to Redis PubSub channel `sync:<orgId>`
 *  3. Broadcasts incoming SyncActions to all connected org clients
 *  4. Sends periodic pings and handles pong / reconnection
 */

import { createServer } from 'node:http';
import Redis from 'ioredis';
import { type WebSocket, WebSocketServer } from 'ws';
import { verifyAccessToken } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { ConnectionManager } from './connection-manager';

const log = childLogger({ module: 'ws' });

const PORT = Number(process.env.WS_PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PING_INTERVAL_MS = 30_000;

// verifyAccessToken() reads JWT_SECRET via getSecret() and throws if unset
if (!process.env.JWT_SECRET) {
  log.fatal('JWT_SECRET is not set — cannot verify tokens');
  process.exit(1);
}

// ─── Redis ───────────────────────────────────────────────────────────────────

const redisSubscriber = new Redis(REDIS_URL, { lazyConnect: false });
const connectionManager = new ConnectionManager();

// Track which org channels we've already subscribed to
const subscribedOrgs = new Set<string>();

async function ensureOrgSubscription(orgId: string) {
  if (subscribedOrgs.has(orgId)) {
    return;
  }
  // Add to set only after a successful subscribe to avoid masking future retries
  await redisSubscriber.subscribe(`sync:${orgId}`);
  subscribedOrgs.add(orgId);
  log.info({ orgId }, 'Subscribed to Redis channel');
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

// ─── HTTP + WS server ────────────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200);
  res.end('WebSocket server');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', async (ws: WebSocket, req) => {
  // Extract token from query string: ws://host:3001/?token=<jwt>
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  let orgId: string;
  let userId: string;

  try {
    ({ orgId, userId } = await verifyAccessToken(token));
    if (!orgId || !userId) {
      throw new Error('Invalid token payload');
    }
  } catch {
    ws.close(4001, 'Invalid token');
    return;
  }

  // Register client
  const clientInfo = connectionManager.add(orgId, userId, ws);
  await ensureOrgSubscription(orgId);

  log.info({ orgId, total: connectionManager.clientCount(), userId }, 'Client connected');

  // Send initial connection ack
  ws.send(JSON.stringify({ cmd: 'connected', orgId }));

  // Periodic ping
  const pingTimer = setInterval(() => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ cmd: 'ping' }));
    }
  }, PING_INTERVAL_MS);

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as { cmd: string };
      if (msg.cmd === 'pong') {
        // Client is alive — nothing to do
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    const orgEmpty = connectionManager.remove(clientInfo);
    log.info({ orgId, total: connectionManager.clientCount(), userId }, 'Client disconnected');
    if (orgEmpty) {
      subscribedOrgs.delete(orgId);
      redisSubscriber.unsubscribe(`sync:${orgId}`).catch((err: Error) => {
        log.error({ err, orgId }, 'Failed to unsubscribe from Redis channel');
      });
    }
  });

  ws.on('error', (err: Error) => {
    log.error({ err, orgId }, 'Client error');
  });
});

httpServer.listen(PORT, () => {
  log.info({ port: PORT }, 'WebSocket server listening');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  wss.close();
  redisSubscriber.disconnect();
  httpServer.close();
  process.exit(0);
});
