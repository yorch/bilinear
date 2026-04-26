/**
 * WebSocket client with automatic reconnection and ping/pong handling.
 * Connects to the standalone WS server (default port 3001).
 */

export type WsMessage =
  | { cmd: 'connected'; orgId: string }
  | { cmd: 'sync'; sync: SerializedSyncAction[] }
  | { cmd: 'ping' }
  | { cmd: 'pong' }
  | { cmd: 'resync' };

export interface SerializedSyncAction {
  id: string;
  organizationId: string;
  action: string;
  modelName: string;
  modelId: string;
  data: object | null;
  createdAt: string;
}

type MessageHandler = (msg: WsMessage) => void;
type StatusHandler = (connected: boolean) => void;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

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

  connect(token: string) {
    this.token = token;
    this.destroyed = false;
    this.openSocket();
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private openSocket() {
    if (this.destroyed || !this.token || !this.wsUrl) {
      return;
    }

    const url = `${this.wsUrl}?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.notifyStatus(true);
    };

    ws.onmessage = (event: MessageEvent) => {
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
      this.notifyStatus(false);
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        MAX_RECONNECT_DELAY_MS,
      );
      this.openSocket();
    }, this.reconnectDelay);
  }

  private notifyStatus(connected: boolean) {
    for (const handler of this.statusHandlers) {
      handler(connected);
    }
  }
}
