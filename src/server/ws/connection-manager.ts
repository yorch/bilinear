import type { WebSocket } from 'ws';

interface ClientInfo {
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
    this.clients.get(orgId)!.add(info);
    return info;
  }

  /** Returns true if the org now has no remaining clients. */
  remove(info: ClientInfo): boolean {
    const set = this.clients.get(info.orgId);
    if (!set) return true;
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
    if (!set) return;
    for (const info of set) {
      if (info.ws.readyState === 1 /* OPEN */) {
        info.ws.send(message);
      }
    }
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
