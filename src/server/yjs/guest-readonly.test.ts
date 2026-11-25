/**
 * End-to-end over a real socket: a real Hocuspocus server (the module's own
 * `server` config) and a real `@hocuspocus/provider` client. A guest on the
 * document's team must be able to READ the document but every edit they make
 * must be dropped — GraphQL's document write gate refuses guests, so the
 * collaborative channel may not be a way around it.
 */
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const DOC_ID = '00000000-0000-0000-0000-00000000d0c1';
const TEAM_ID = '00000000-0000-0000-0000-0000000000aa';
const ORG = '00000000-0000-0000-0000-0000000000f0';

const roles: Record<string, string> = { guest: 'guest', member: 'member' };
const stored = vi.hoisted(() => ({ updates: 0 }));

vi.mock('@/server/lib/jwt', () => ({
  verifyWsTicket: async (t: string) => ({
    orgId: '00000000-0000-0000-0000-0000000000f0',
    userId: t,
  }),
}));
vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    document: {
      findFirst: async () => ({ contentState: null, id: DOC_ID, teamId: TEAM_ID }),
      update: async () => {
        stored.updates++;
      },
    },
    issue: { findFirst: async () => null },
    organization: { findUnique: async () => ({ archivedAt: null, suspendedAt: null }) },
    organizationMember: { findUnique: async () => ({ role: 'member' }) },
    teamMemberRole: {
      findUnique: async ({ where }: { where: { teamId_userId: { userId: string } } }) => ({
        role: roles[where.teamId_userId.userId],
      }),
    },
    teamMembership: {
      findUnique: async () => ({ team: { organizationId: ORG } }),
    },
    user: { findUnique: async () => ({ active: true }) },
  },
}));

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const Y = require('yjs');
const { HocuspocusProvider, HocuspocusProviderWebsocket } = require('@hocuspocus/provider');

import { server } from './server';

const PORT = 18234;

function connect(userId: string) {
  const doc = new Y.Doc() as import('yjs').Doc;
  const ws = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${PORT}`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document: doc,
    name: `document:${DOC_ID}`,
    token: userId,
    websocketProvider: ws,
  });
  provider.attach();
  const synced = new Promise<void>(res => provider.on('synced', () => res()));
  return {
    close: () => {
      provider.destroy();
      ws.destroy();
    },
    doc,
    synced,
  };
}

describe('yjs guest read-only on team documents', () => {
  beforeAll(async () => {
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.destroy();
  });

  it('applies a member edit but drops a guest edit', async () => {
    const member = connect('member');
    const guest = connect('guest');
    await Promise.all([member.synced, guest.synced]);

    guest.doc.getText('t').insert(0, 'GUEST');
    member.doc.getText('t').insert(0, 'MEMBER');
    await new Promise(r => setTimeout(r, 800));

    // The member's edit reached the server (and the guest, who may read)...
    expect(guest.doc.getText('t').toString()).toContain('MEMBER');
    // ...but the guest's did not reach the member.
    expect(member.doc.getText('t').toString()).not.toContain('GUEST');
    member.close();
    guest.close();
  });
});
