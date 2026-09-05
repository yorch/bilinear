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

describe('ConnectionManager.broadcastActions', () => {
  const restricted = { guestTeamIds: [], hiddenTeamIds: ['t-hidden'], userId: 'guest' };

  it('sends the full frame to unrestricted sockets and a filtered one to restricted sockets', async () => {
    const cm = new ConnectionManager();
    const open = fakeWs();
    const locked = fakeWs();
    cm.add('org-1', 'member', open);
    cm.add('org-1', 'guest', locked, restricted);
    const actions = [{ teamId: 't-hidden' }, { teamId: 't-open' }];
    const filter = vi.fn(async (_v: unknown, batch: typeof actions) =>
      batch.filter(a => a.teamId !== 't-hidden'),
    );

    await cm.broadcastActions('org-1', actions, filter);

    expect(open.send).toHaveBeenCalledWith(JSON.stringify({ cmd: 'sync', sync: actions }));
    expect(locked.send).toHaveBeenCalledWith(
      JSON.stringify({ cmd: 'sync', sync: [{ teamId: 't-open' }] }),
    );
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it('runs the filter once per restricted user, not once per socket', async () => {
    const cm = new ConnectionManager();
    const a = fakeWs();
    const b = fakeWs();
    cm.add('org-1', 'guest', a, restricted);
    cm.add('org-1', 'guest', b, restricted);
    const filter = vi.fn(async (_v: unknown, batch: unknown[]) => batch);

    await cm.broadcastActions('org-1', [{ id: 1 }], filter);

    expect(filter).toHaveBeenCalledTimes(1);
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing to a restricted socket when the batch filters to empty', async () => {
    const cm = new ConnectionManager();
    const locked = fakeWs();
    cm.add('org-1', 'guest', locked, restricted);

    await cm.broadcastActions('org-1', [{ id: 1 }], async () => []);

    expect(locked.send).not.toHaveBeenCalled();
  });

  it('treats an unrestricted scope as null and tracks sockets per user', () => {
    const cm = new ConnectionManager();
    const info = cm.add('org-1', 'u', fakeWs(), {
      guestTeamIds: [],
      hiddenTeamIds: [],
      userId: 'u',
    });
    expect(info.visibility).toBeNull();
    cm.add('org-1', 'u', fakeWs());
    cm.add('org-1', 'other', fakeWs());
    expect(cm.countForUser('org-1', 'u')).toBe(2);
    cm.setVisibility(info, restricted);
    expect(info.visibility).toEqual(restricted);
    cm.setVisibility(info, { guestTeamIds: [], hiddenTeamIds: [], userId: 'u' });
    expect(info.visibility).toBeNull();
  });
});
