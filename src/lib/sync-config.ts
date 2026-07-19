/**
 * Sync constants that must stay identical across the client/server boundary.
 *
 * This module is intentionally dependency-free (no imports, no client-only or
 * server-only APIs) so it can be imported from both browser bundles
 * (`src/lib/sync-manager.ts`, `src/lib/ws-client.ts`) and server-only code
 * (`src/server/services/sync.service.ts`, `src/server/ws/index.ts`) without
 * pulling either side into the other's bundle. Do not add imports here.
 */

/**
 * Safety window for the server's committed-at watermark. Rows committed
 * inside this window may have been preceded by a row whose transaction was
 * still in-flight at the server's last read, so the server withholds them
 * from delta-sync responses until the window elapses. The client sizes its
 * post-connect / post-drain follow-up delta delays off this value (see
 * `src/lib/sync-manager.ts`'s `scheduleFollowUpDelta`/`handleTransactionDrained`)
 * to guarantee the follow-up lands after the watermark has cleared.
 */
export const COMMIT_WATERMARK_LAG_MS = 500;

/**
 * Maximum SyncAction rows returned per delta-sync page. Enforced by the
 * server (`src/server/services/sync.service.ts`); the client's
 * `MAX_DELTA_PAGES` bound (`src/lib/sync-manager.ts`) assumes this page size
 * when reasoning about the largest offline backlog it can fully drain.
 */
export const DELTA_PAGE_SIZE = 5000;

/**
 * Cadence at which the WS server pings each connected client to detect dead
 * connections. Server-only value, but kept here alongside its dependent
 * (`WS_PONG_TIMEOUT_MS`) and the client's own heartbeat timeout for a single
 * source of truth on the ping/pong contract.
 */
export const WS_PING_INTERVAL_MS = 30_000;

/**
 * Server-side cutoff: force-terminate a client that hasn't responded to two
 * consecutive pings, so half-open TCP connections don't accumulate
 * ConnectionManager entries. Derived from `WS_PING_INTERVAL_MS` so the two
 * values can't drift independently.
 */
export const WS_PONG_TIMEOUT_MS = WS_PING_INTERVAL_MS * 2 + 5_000;

/**
 * Client-side force-reconnect window: if no frame (data or ping) has arrived
 * for this long, the client presumes the underlying socket is dead even if
 * the OS hasn't reaped it. Intentionally looser than the server's
 * `WS_PONG_TIMEOUT_MS` cutoff (65s) — kept at the existing 75s value rather
 * than derived, so the client always gives the server's own timeout a chance
 * to fire first.
 */
export const WS_HEARTBEAT_CLIENT_TIMEOUT_MS = 75_000;
