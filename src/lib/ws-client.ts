/**
 * WebSocket client with automatic reconnection and ping/pong handling.
 * Connects to the standalone WS server (default port 3001).
 *
 * Authentication uses short-lived (60s) WS tickets fetched from
 * `/api/auth/ws-ticket`. The endpoint reads the httpOnly access cookie
 * server-side and returns a narrowly-scoped ticket — the long-lived
 * access token never reaches client JavaScript. A fresh ticket is
 * fetched on every (re)connect, so reconnects after the 60s ticket
 * lifetime still authenticate.
 */

export type WsMessage =
  | { cmd: 'connected'; orgId: string }
  | { cmd: 'sync'; sync: SerializedSyncAction[] }
  | { cmd: 'ping' }
  | { cmd: 'pong' }
  | { cmd: 'resync' };

export interface SerializedSyncAction {
  action: string;
  /**
   * Statement-time commit watermark for this row (`sync_actions.committed_at`).
   * The delta-sync cursor is a `(committedAt, id)` tuple — BIGSERIAL ids alone
   * can race when transactions commit out of order, so this field is what
   * the client uses to advance `lastSyncId` (encoded as `committedAtMicros-id`).
   */
  committedAt: string;
  createdAt: string;
  data: object | null;
  id: string;
  modelId: string;
  modelName: string;
  organizationId: string;
}

type MessageHandler = (msg: WsMessage) => void;
type StatusHandler = (connected: boolean) => void;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
// If we haven't received any frame (data or ping) for this long, the
// underlying socket is presumed dead even if the OS hasn't reaped it.
// Server pings every 30s, so 75s gives 2 missed pings of slack before
// we force a reconnect.
const HEARTBEAT_TIMEOUT_MS = 75_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private connected = false;

  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();

  private wsUrl: string;

  constructor(wsUrl?: string) {
    this.wsUrl = wsUrl ?? this.resolveWsUrl();
  }

  private resolveWsUrl(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    const wsPort = process.env.NEXT_PUBLIC_WS_PORT ?? '3001';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.hostname}:${wsPort}`;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  connect() {
    this.destroyed = false;
    void this.openSocket();
  }

  disconnect() {
    this.destroyed = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.ws?.close();
    this.ws = null;
  }

  private async fetchTicket(): Promise<string | null> {
    try {
      const res = await fetch('/api/auth/ws-ticket', {
        credentials: 'include',
        method: 'GET',
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { ticket?: string };
      return data.ticket ?? null;
    } catch {
      return null;
    }
  }

  private async openSocket() {
    if (this.destroyed || !this.wsUrl) {
      return;
    }

    const ticket = await this.fetchTicket();
    if (this.destroyed) {
      return;
    }
    if (!ticket) {
      // Authentication failed (no session, or token rejected). Schedule a
      // retry — the user may sign in again shortly, or this is a transient
      // network blip on the ticket endpoint.
      this.scheduleReconnect();
      return;
    }

    const url = `${this.wsUrl}?token=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.connected = true;
      this.resetHeartbeat();
      this.notifyStatus(true);
    };

    ws.onmessage = (event: MessageEvent) => {
      this.resetHeartbeat();
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        if (msg.cmd === 'ping') {
          ws.send(JSON.stringify({ cmd: 'pong' }));
          return;
        }
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      this.clearHeartbeatTimer();
      // Only notify "disconnected" if we had previously notified "connected".
      // A failed handshake should not flip status downstream — scheduleReconnect
      // already handles the retry.
      if (this.connected) {
        this.connected = false;
        this.notifyStatus(false);
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror, so reconnect is handled there
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) {
      return;
    }
    // Clear any pending timer first — without this, rapid open/close churn
    // can stack timers and produce duplicate sockets on every reconnect.
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      void this.openSocket();
    }, this.reconnectDelay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private resetHeartbeat() {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      // No frames for too long — force a reconnect rather than wait for
      // the OS to reap a half-open TCP connection.
      this.ws?.close();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private notifyStatus(connected: boolean) {
    for (const handler of this.statusHandlers) {
      handler(connected);
    }
  }
}
