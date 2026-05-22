/**
 * Entry point for the standalone YJS collaborative editing server.
 *
 * Run with:  yarn yjs:server
 * Default port: 1234 (override with YJS_PORT env var).
 *
 * Auth uses the same JWT_SECRET as the main WS server (ws_ticket tokens).
 */

import { childLogger } from '@/server/lib/logger';
import { server } from './server';

const log = childLogger({ module: 'yjs' });
const PORT = Number(process.env.YJS_PORT ?? 1234);

if (!process.env.JWT_SECRET) {
  log.fatal('JWT_SECRET is not set — cannot verify ws_ticket tokens');
  process.exit(1);
}

server
  .listen(PORT)
  .then(() => {
    log.info({ port: PORT }, 'YJS collaborative editing server ready');
  })
  .catch((err: unknown) => {
    log.fatal({ err }, 'Failed to start YJS server');
    process.exit(1);
  });

async function shutdown() {
  await server.destroy();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
// SIGINT handles Ctrl+C in local dev / some container runtimes
process.on('SIGINT', shutdown);
