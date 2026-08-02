/**
 * Coalesces per-org SyncAction broadcasts over a short flush window (§3.2).
 *
 * The Redis subscriber fires one `message` per SyncAction; broadcasting each
 * individually is one `ws.send` per client per action (10k sends/s at
 * 1000 users × 10 mut/s). Buffering per org and flushing once per window
 * collapses that to one `{ cmd: 'sync', sync: [...] }` frame per org per
 * window — the client already applies `sync` arrays, so this is a pure
 * server-side change. Wall-clock latency rises by at most `windowMs`.
 *
 * Kept side-effect-free (timer + a flush callback, no ws/Redis access) so it's
 * unit-testable with fake timers.
 */
export class SyncBroadcastBatcher<T = unknown> {
  private buffers = new Map<string, T[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly flush: (orgId: string, actions: T[]) => void,
    private readonly windowMs: number,
  ) {}

  /** Buffer an action for `orgId`, scheduling a flush if one isn't pending. */
  add(orgId: string, action: T): void {
    let buf = this.buffers.get(orgId);
    if (!buf) {
      buf = [];
      this.buffers.set(orgId, buf);
    }
    buf.push(action);
    if (!this.timers.has(orgId)) {
      this.timers.set(
        orgId,
        setTimeout(() => this.flushOrg(orgId), this.windowMs),
      );
    }
  }

  private flushOrg(orgId: string): void {
    const timer = this.timers.get(orgId);
    if (timer) {
      clearTimeout(timer);
    }
    this.timers.delete(orgId);
    const buf = this.buffers.get(orgId);
    this.buffers.delete(orgId);
    if (buf && buf.length > 0) {
      this.flush(orgId, buf);
    }
  }

  /** Flush every pending org immediately (e.g. on shutdown). */
  flushAll(): void {
    for (const orgId of [...this.timers.keys()]) {
      this.flushOrg(orgId);
    }
  }
}
