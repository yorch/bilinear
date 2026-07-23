import type { WebSocket } from 'ws';

export interface ClientInfo {
  orgId: string;
  userId: string;
  ws: WebSocket;
}

/**
 * Tracks all connected WebSocket clients, indexed by organization ID.
 * Provides broadcast methods for sync actions.
 */
export class ConnectionManager {
  private clients = new Map<string, Set<ClientInfo>>();

  add(orgId: string, userId: string, ws: WebSocket) {
    if (!this.clients.has(orgId)) {
      this.clients.set(orgId, new Set());
    }
    const info: ClientInfo = { orgId, userId, ws };
    this.clients.get(orgId)?.add(info);
    return info;
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
      if (info.ws.readyState === 1 /* OPEN */) {
        info.ws.send(message);
      }
    }
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
