import { env } from '@/server/lib/env';
import type { CollabConfig } from './collab';

/**
 * Server-only: resolve the collaborative-editing config the root layout hands
 * to `CollabProvider`, mirroring how `getServerAccent()` resolves the accent
 * before first paint.
 *
 * Read at request time, so a deployment can turn collab on or repoint the YJS
 * server by restarting the container — no rebuild, which is the whole point
 * (see `src/lib/collab.ts`).
 */
export function getServerCollabConfig(): CollabConfig {
  return { enabled: env.COLLAB_ENABLED, serverUrl: env.YJS_PUBLIC_URL };
}
