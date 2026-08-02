import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { ConnectionManager, SLOW_CLIENT_CLOSE_CODE } from './connection-manager';

function fakeWs(overrides: Partial<{ bufferedAmount: number; readyState: number }> = {}) {
  return {
    bufferedAmount: 0,
    close: vi.fn(),
    readyState: 1, // OPEN
    send: vi.fn(),
    ...overrides,
  } as unknown as WebSocket & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

describe('ConnectionManager.broadcastToOrgAll', () => {
  it('sends to open clients within the buffer threshold', () => {
    const cm = new ConnectionManager();
    const ws = fakeWs();
    cm.add('org-1', 'user-1', ws);

    cm.broadcastToOrgAll('org-1', 'hello');
    expect(ws.send).toHaveBeenCalledWith('hello');
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('skips clients that are not OPEN', () => {
    const cm = new ConnectionManager();
    const ws = fakeWs({ readyState: 0 /* CONNECTING */ });
    cm.add('org-1', 'user-1', ws);

    cm.broadcastToOrgAll('org-1', 'hello');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('closes (not sends to) a slow client whose buffer exceeds the threshold', () => {
    const cm = new ConnectionManager();
    const slow = fakeWs({ bufferedAmount: 2_000_000 });
    const healthy = fakeWs({ bufferedAmount: 0 });
    cm.add('org-1', 'user-1', slow);
    cm.add('org-1', 'user-2', healthy);

    cm.broadcastToOrgAll('org-1', 'hello');

    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.close).toHaveBeenCalledWith(SLOW_CLIENT_CLOSE_CODE, 'slow client');
    // The slow client doesn't block delivery to the healthy one.
    expect(healthy.send).toHaveBeenCalledWith('hello');
  });
});
