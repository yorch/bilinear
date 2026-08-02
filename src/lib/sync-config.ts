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
 * Client-side settle delay for follow-up delta syncs. The server no longer
 * applies a wall-clock watermark — delta reads are fenced on the writing
 * transaction's xid8 (`xact_id < pg_snapshot_xmin(...)`), so a row becomes
 * delta-visible exactly when its transaction settles, however long that
 * takes. The client still schedules a short follow-up delta after a
 * (re)connect / queue drain to cover the Redis pub/sub no-replay gap (a
 * message published before this client's SUBSCRIBE completed is lost); this
 * value is how long it waits for the just-committed transaction to settle
 * before re-reading. See `src/lib/sync-manager.ts`'s
 * `scheduleFollowUpDelta`/`handleTransactionDrained`. Named for the former
 * server watermark it replaced, kept identical so the timing is unchanged.
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
 * Upper bound distinguishing a real `xact_id` (the current `<xactId>-<id>`
 * cursor's first component) from a stale first component left by an OLDER
 * cursor encoding. The delta cursor was briefly `<committedAtMicros>-<id>`
 * before moving to `<xactId>-<id>`; a client (or IndexedDB `lastSyncId`)
 * carrying that intermediate form would otherwise be parsed as an astronomically
 * large `xactId` (epoch-microseconds ≈ 1.7e15), making `xact_id > <that>` match
 * zero rows and wedging delta sync forever. Real xid8 values grow by one per
 * write transaction, so they stay far below this ceiling for millennia; any
 * parsed first component at or above it is treated as a stale/unknown cursor and
 * reset to the zero cursor, which triggers a one-time full re-read (safe,
 * idempotent) instead of a silent stall. Shared by `SyncService.parseCursor`
 * (server) and `sync-manager`'s `splitCursor` (client) so both self-heal.
 */
export const MAX_PLAUSIBLE_XACT_ID = BigInt('1000000000000000');

/**
 * Per-org SyncAction broadcast coalescing window (§3.2). The WS server buffers
 * incoming SyncActions per org and flushes them as a single `sync` frame after
 * this many ms, instead of one `ws.send` per action. Adds at most this much
 * delivery latency; the client already applies `sync` arrays.
 */
export const WS_BROADCAST_COALESCE_MS = 50;

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

/**
 * How long `sync_actions` rows are retained. The table is append-only and
 * grows without bound otherwise — every mutation in the workspace writes one.
 *
 * The window has to exceed the longest realistic offline gap, because a client
 * whose cursor predates the oldest retained row cannot be caught up by delta
 * sync: the actions it missed are gone. `getDeltaSyncActions` detects exactly
 * that case and returns `staleCursor`, which makes the client discard its cache
 * and re-bootstrap instead of silently carrying a permanently-stale pool.
 */
export const SYNC_ACTION_RETENTION_DAYS = 30;

/**
 * Cadence of the retention sweep that enforces `SYNC_ACTION_RETENTION_DAYS`.
 * Hourly is far more often than necessary for a 30-day window; it keeps each
 * individual delete small rather than accumulating a day's worth of rows into
 * one long-running statement.
 */
export const SYNC_ACTION_PRUNE_INTERVAL_MS = 60 * 60_000;
