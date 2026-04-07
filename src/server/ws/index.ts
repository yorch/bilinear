/**
 * Standalone WebSocket server for real-time sync broadcasting.
 *
 * Run with:  yarn ws:server
 *
 * It:
 *  1. Authenticates clients via JWT (passed as a query param or first message)
 *  2. Subscribes to Redis PubSub channel `sync:<orgId>`
 *  3. Broadcasts incoming SyncActions to all connected org clients
 *  4. Sends periodic pings and handles pong / reconnection
 */

import { createServer } from 'node:http';
import { jwtVerify } from 'jose';
import Redis from 'ioredis';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConnectionManager } from './connection-manager';

const PORT = Number(process.env.WS_PORT ?? 3001);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PING_INTERVAL_MS = 30_000;

if (!JWT_SECRET) {
  console.error('[ws] JWT_SECRET is not set — cannot verify tokens');
  process.exit(1);
}

// ─── Redis ───────────────────────────────────────────────────────────────────

const redisSubscriber = new Redis(REDIS_URL, { lazyConnect: false });
const connectionManager = new ConnectionManager();

// Track which org channels we've already subscribed to
const subscribedOrgs = new Set<string>();

async function ensureOrgSubscription(orgId: string) {
  if (subscribedOrgs.has(orgId)) return;
  subscribedOrgs.add(orgId);
  await redisSubscriber.subscribe(`sync:${orgId}`);
  console.log(`[ws] Subscribed to Redis channel sync:${orgId}`);
}

redisSubscriber.on('message', (channel: string, message: string) => {
  // channel = "sync:<orgId>"
  const orgId = channel.slice('sync:'.length);
  const payload = JSON.stringify({ cmd: 'sync', sync: [JSON.parse(message)] });
  connectionManager.broadcastToOrgAll(orgId, payload);
});

redisSubscriber.on('error', (err: Error) => {
  console.error('[ws] Redis subscriber error:', err);
});

// ─── HTTP + WS server ────────────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200);
  res.end('WebSocket server');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', async (ws: WebSocket, req) => {
  // Extract token from query string: ws://host:3001/ws?token=<jwt>
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  let orgId: string;
  let userId: string;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    orgId = payload.orgId as string;
    userId = payload.userId as string;
    if (!orgId || !userId) throw new Error('Invalid token payload');
  } catch {
    ws.close(4001, 'Invalid token');
    return;
  }

  // Register client
  const clientInfo = connectionManager.add(orgId, userId, ws);
  await ensureOrgSubscription(orgId);

  console.log(
    `[ws] Client connected — org:${orgId} user:${userId} total:${connectionManager.clientCount()}`,
  );

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
    console.log(
      `[ws] Client disconnected — org:${orgId} user:${userId} total:${connectionManager.clientCount()}`,
    );
    if (orgEmpty) {
      subscribedOrgs.delete(orgId);
      redisSubscriber.unsubscribe(`sync:${orgId}`).catch((err: Error) => {
        console.error(`[ws] Failed to unsubscribe from sync:${orgId}:`, err.message);
      });
    }
  });

  ws.on('error', (err: Error) => {
    console.error(`[ws] Client error — org:${orgId}:`, err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[ws] WebSocket server listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  wss.close();
  redisSubscriber.disconnect();
  httpServer.close();
  process.exit(0);
});
