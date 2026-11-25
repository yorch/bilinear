/**
 * Periodic access sweep (`sweepRevokedYjsConnections`) over a real Hocuspocus
 * server and real `@hocuspocus/provider` clients, with a mutable in-memory
 * access model so access can change AFTER the connection is up. The sweep is
 * invoked directly instead of waiting out its 60 s timer.
 *
 * What is asserted is `connection.close()` on the server-side connection of
 * each user (spied, calling through). A client-side observation would be
 * ambiguous: the provider auto-reconnects, and a deactivated user would
 * reconnect successfully because connect-time auth does not check `active`.
 * The entitled-member control runs through the identical flow, so the
 * "not closed" assertions cannot pass merely because the sweep does nothing.
 */
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const DOC_ID = '00000000-0000-0000-0000-00000000d0c1';

const state = vi.hoisted(() => ({
  active: new Set<string>(),
  roles: {} as Record<string, string>,
  teamMembers: new Set<string>(),
}));

vi.mock('@/server/lib/jwt', () => ({
  verifyWsTicket: async (t: string) => ({
    orgId: '00000000-0000-0000-0000-0000000000f0',
    userId: t,
  }),
}));
vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    document: {
      findFirst: async () => ({
        contentState: null,
        id: '00000000-0000-0000-0000-00000000d0c1',
        teamId: '00000000-0000-0000-0000-0000000000aa',
      }),
      update: async () => undefined,
    },
    issue: { findFirst: async () => null, update: async () => undefined },
    organization: { findUnique: async () => ({ archivedAt: null, suspendedAt: null }) },
    organizationMember: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.map(userId => ({ role: 'member', userId })),
      findUnique: async () => ({ role: 'member' }),
    },
    teamMemberRole: {
      findUnique: async ({ where }: { where: { teamId_userId: { userId: string } } }) => {
        const role = state.roles[where.teamId_userId.userId];
        return role ? { role } : null;
      },
    },
    teamMembership: {
      findUnique: async ({ where }: { where: { teamId_userId: { userId: string } } }) =>
        state.teamMembers.has(where.teamId_userId.userId)
          ? { team: { organizationId: '00000000-0000-0000-0000-0000000000f0' } }
          : null,
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map(id => ({ active: state.active.has(id), id })),
      findUnique: async ({ where }: { where: { id: string } }) => ({
        active: state.active.has(where.id),
      }),
    },
  },
}));

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const Y = require('yjs');
const { HocuspocusProvider, HocuspocusProviderWebsocket } = require('@hocuspocus/provider');

import { server, sweepRevokedYjsConnections } from './server';

const PORT = 18236;
const DOC_NAME = `document:${DOC_ID}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const clients: Array<{ close: () => void }> = [];

function connect(userId: string) {
  const doc = new Y.Doc();
  const ws = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${PORT}`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document: doc,
    name: DOC_NAME,
    token: userId,
    websocketProvider: ws,
  });
  provider.attach();
  const synced = new Promise<void>(res => provider.on('synced', () => res()));
  const client = {
    close: () => {
      provider.destroy();
      ws.destroy();
    },
    synced,
  };
  clients.push(client);
  return client;
}

/** The server-side connection(s) of `userId` in the room, with `close` spied. */
function serverConnections(userId: string) {
  const document = server.hocuspocus.documents.get(DOC_NAME);
  const found = [...(document?.getConnections() ?? [])].filter(
    c => (c.context as { userId?: string } | undefined)?.userId === userId,
  );
  return found.map(connection => ({
    closeSpy: vi.spyOn(connection, 'close'),
    connection,
  }));
}

describe('yjs periodic access sweep', () => {
  beforeAll(async () => {
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.destroy();
  });
  beforeEach(async () => {
    state.active = new Set(['member', 'other']);
    state.teamMembers = new Set(['member', 'other']);
    state.roles = { member: 'member', other: 'member' };
    await sleep(200); // let the previous test's rooms unload
  });
  afterEach(() => {
    for (const c of clients.splice(0)) {
      c.close();
    }
  });

  it('control: an entitled member connection survives the sweep', async () => {
    const m = connect('member');
    await m.synced;
    const [conn] = serverConnections('member');
    expect(conn).toBeDefined();
    await sweepRevokedYjsConnections();
    expect(conn.closeSpy).not.toHaveBeenCalled();
  });

  it('closes the connection of a user removed from the private team after connecting', async () => {
    const m = connect('member');
    const o = connect('other');
    await Promise.all([m.synced, o.synced]);
    const [removed] = serverConnections('member');
    const [kept] = serverConnections('other');
    expect(removed).toBeDefined();
    state.teamMembers.delete('member');
    await sweepRevokedYjsConnections();
    expect(removed.closeSpy).toHaveBeenCalledTimes(1);
    expect(kept.closeSpy).not.toHaveBeenCalled(); // peer in the same room is untouched
  });

  it('closes the writable connection of a member demoted to guest', async () => {
    const m = connect('member');
    await m.synced;
    const [conn] = serverConnections('member');
    expect(conn.connection.readOnly).toBe(false);
    state.roles.member = 'guest';
    await sweepRevokedYjsConnections();
    expect(conn.closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not close a guest connection that is already read-only', async () => {
    state.teamMembers.add('guest');
    state.roles.guest = 'guest';
    state.active.add('guest');
    const g = connect('guest');
    await g.synced;
    const [conn] = serverConnections('guest');
    expect(conn.connection.readOnly).toBe(true);
    await sweepRevokedYjsConnections();
    expect(conn.closeSpy).not.toHaveBeenCalled();
  });

  it('closes the connection of a user deactivated after connecting', async () => {
    const m = connect('member');
    const o = connect('other');
    await Promise.all([m.synced, o.synced]);
    const [gone] = serverConnections('member');
    const [kept] = serverConnections('other');
    state.active.delete('member');
    await sweepRevokedYjsConnections();
    expect(gone.closeSpy).toHaveBeenCalledTimes(1);
    expect(kept.closeSpy).not.toHaveBeenCalled();
  });
});
