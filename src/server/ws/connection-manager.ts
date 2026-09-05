import type { WebSocket } from 'ws';
import { isUnrestricted, type SyncVisibility } from '@/server/lib/sync-visibility';

export interface ClientInfo {
  orgId: string;
  userId: string;
  /**
   * What this socket may receive. `null` means unrestricted — the common
   * case, which takes the shared pre-serialised frame. A restricted scope
   * (guest somewhere, or locked out of a private team) has the batch filtered
   * per socket before it is sent. Refreshed by the re-auth sweep so a
   * membership change or a private flag flipped stops the stream within one
   * sweep interval, the same window the sweep already gives revocation.
   */
  visibility: SyncVisibility | null;
  ws: WebSocket;
}

/** Narrows a batch of actions to what one restricted scope may receive. */
export type VisibilityFilter<T> = (visibility: SyncVisibility, actions: T[]) => Promise<T[]>;

/**
 * Cap on simultaneous sockets per (org, user). A browser with a dozen tabs is
 * well under this; a script opening sockets in a loop is what it bounds.
 */
export const MAX_SOCKETS_PER_USER = 32;

// Back-pressure threshold: a client whose outbound buffer has grown past this
// (a paused tab, a dead-but-not-yet-reaped socket) is disconnected rather than
// left to pin memory for the whole org. It reconnects and re-runs delta, so no
// data is lost. ~1MB — comfortably above a normal batched frame.
const MAX_BUFFERED_BYTES = 1_000_000;
// Close code for a slow-client disconnect (application range 4000–4999).
export const SLOW_CLIENT_CLOSE_CODE = 4002;

/**
 * Tracks all connected WebSocket clients, indexed by organization ID.
 * Provides broadcast methods for sync actions.
 */
export class ConnectionManager {
  private clients = new Map<string, Set<ClientInfo>>();

  add(orgId: string, userId: string, ws: WebSocket, visibility: SyncVisibility | null = null) {
    if (!this.clients.has(orgId)) {
      this.clients.set(orgId, new Set());
    }
    const info: ClientInfo = {
      orgId,
      userId,
      visibility: visibility && !isUnrestricted(visibility) ? visibility : null,
      ws,
    };
    this.clients.get(orgId)?.add(info);
    return info;
  }

  /** Replace a live socket's scope (re-auth sweep). Unrestricted collapses to `null`. */
  setVisibility(info: ClientInfo, visibility: SyncVisibility): void {
    info.visibility = isUnrestricted(visibility) ? null : visibility;
  }

  /** Open sockets held by one user in one org. */
  countForUser(orgId: string, userId: string): number {
    let n = 0;
    for (const info of this.clients.get(orgId) ?? []) {
      if (info.userId === userId) {
        n += 1;
      }
    }
    return n;
  }

  /** Returns true if the org now has no remaining clients. */
  remove(info: ClientInfo): boolean {
    const set = this.clients.get(info.orgId);
    if (!set) {
      return true;
    }
    set.delete(info);
    if (set.size === 0) {
      this.clients.delete(info.orgId);
      return true;
    }
    return false;
  }

  /**
   * Broadcast a message to ALL clients in an organization including the sender.
   */
  broadcastToOrgAll(orgId: string, message: string) {
    const set = this.clients.get(orgId);
    if (!set) {
      return;
    }
    for (const info of set) {
      this.sendTo(info, message);
    }
  }

  /**
   * Broadcast one batch of SyncActions to an org, narrowing it per socket.
   *
   * Unrestricted sockets (the common case) all get the same pre-serialised
   * frame. A restricted socket gets the batch run through `filter` first;
   * the filtered result is computed once per distinct scope-holder (keyed by
   * user, since scope is a property of the user in the org, not of the tab)
   * and a batch that filters down to nothing sends no frame at all. The
   * filter may hit the database, so restricted sends complete asynchronously
   * and out of order with the unrestricted ones — harmless, because every
   * client orders by the actions' own sync ids, not by arrival.
   */
  broadcastActions<T>(orgId: string, actions: T[], filter: VisibilityFilter<T>): Promise<void> {
    const set = this.clients.get(orgId);
    if (!set || actions.length === 0) {
      return Promise.resolve();
    }
    const full = JSON.stringify({ cmd: 'sync', sync: actions });
    const filteredByUser = new Map<string, Promise<string | null>>();
    const pending: Promise<void>[] = [];
    for (const info of set) {
      if (!info.visibility) {
        this.sendTo(info, full);
        continue;
      }
      let frame = filteredByUser.get(info.userId);
      if (!frame) {
        frame = filter(info.visibility, actions).then(visible =>
          visible.length > 0 ? JSON.stringify({ cmd: 'sync', sync: visible }) : null,
        );
        filteredByUser.set(info.userId, frame);
      }
      pending.push(
        frame.then(message => {
          if (message) {
            this.sendTo(info, message);
          }
        }),
      );
    }
    return Promise.all(pending).then(() => undefined);
  }

  private sendTo(info: ClientInfo, message: string): void {
    if (info.ws.readyState !== 1 /* OPEN */) {
      return;
    }
    // Back-pressure: a client that can't keep up (buffer past the threshold)
    // is closed rather than sent to — its buffer would otherwise grow
    // unbounded and a slow client would pin memory / block the event loop for
    // the whole org. It reconnects and re-runs delta to catch up.
    if (info.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      info.ws.close(SLOW_CLIENT_CLOSE_CODE, 'slow client');
      return;
    }
    info.ws.send(message);
  }

  /**
   * Every currently-tracked client across all orgs, flattened to a single
   * array. Used by the WS server's periodic re-auth sweep, which needs to
   * walk every live connection regardless of org — this is the single
   * source of truth for "what's connected right now", so callers don't need
   * to maintain their own parallel bookkeeping of the same connect/close
   * events this class already tracks.
   */
  getAll(): ClientInfo[] {
    const all: ClientInfo[] = [];
    for (const set of this.clients.values()) {
      for (const info of set) {
        all.push(info);
      }
    }
    return all;
  }

  clientCount(orgId?: string): number {
    if (orgId) {
      return this.clients.get(orgId)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.clients.values()) {
      total += set.size;
    }
    return total;
  }
}
